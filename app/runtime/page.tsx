"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  PHONE_RUNTIME_VERSION,
  ROS_TOPICS,
  createEvidenceArtifact,
  createRuntimeReceipt,
  haversineMeters,
  rosAdvertise,
  rosPublish,
  rosStamp,
  rosSubscribe,
  validateRuntimeJob,
  type DeviceJobRequest,
  type ExecutionMode,
  type RuntimeEvidence,
  type RuntimeScenario,
} from "@/lib/smartphone-runtime";
import styles from "./runtime.module.css";

type JsonRecord = Record<string, unknown>;
type RuntimePhase = "loading" | "empty" | "ready" | "running" | "stopped" | "receipt" | "submitted";
type ReceiptStatus = "SUCCEEDED" | "FAILED" | "ABORTED";
type RosState = "disconnected" | "connecting" | "connected" | "error";

type DesignerResponse = {
  active: null | {
    sessionId: string;
    plan: { id: string; goal: string; scenario?: { title?: string } };
    job: null | {
      id: string;
      status: string;
      request: unknown;
    };
  };
  error?: string;
};

type ImuPoint = {
  captured_at: string;
  acceleration_m_s2: { x: number; y: number; z: number };
  angular_velocity_rad_s: { x: number; y: number; z: number };
};

type RoutePoint = {
  captured_at: string;
  latitude: number;
  longitude: number;
  accuracy_m: number;
};

type VisionPoint = {
  captured_at: string;
  centroid_x: number;
  centroid_y: number;
  motion_ratio: number;
  tracker: "frame_difference";
  identity_inferred: false;
};

type SpeechResultLike = { isFinal: boolean; 0: { transcript: string } };
type SpeechEventLike = { resultIndex: number; results: ArrayLike<SpeechResultLike> };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const MAX_JOB_BYTES = 256 * 1024;
const MAX_IMU_POINTS = 1_200;
const MAX_ROUTE_POINTS = 1_000;
const MAX_VISION_POINTS = 600;
const BROWSER_RUNTIME_JOB_SCHEMA = "campfire.device-job.v3" as const;
const ZERO_COVARIANCE = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const UNKNOWN_ORIENTATION_COVARIANCE = [-1, 0, 0, 0, 0, 0, 0, 0, 0];

const scenarioLabels: Record<string, string> = {
  person_following: "사람 추종 시뮬레이션",
  phone_vision_guide: "스마트폰 비전 가이드",
  gait_route: "보행·경로 관찰",
  campfire_memory: "동의 기반 대화 기억",
};

const phaseLabels: Record<RuntimePhase, string> = {
  loading: "작업 확인 중",
  empty: "작업 필요",
  ready: "실행 준비",
  running: "센서 관찰 중",
  stopped: "관찰 종료",
  receipt: "영수증 생성됨",
  submitted: "워크벤치 기록됨",
};

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function readString(record: JsonRecord, key: string) {
  return typeof record[key] === "string" ? record[key] as string : "";
}

function scenarioFromJob(job: DeviceJobRequest | null): RuntimeScenario | null {
  if (!job) return null;
  const record = asRecord(job);
  const runtimeContract = asRecord(record.runtime_contract ?? record.runtimeContract);
  const experiment = asRecord(record.experiment);
  const candidate = readString(runtimeContract, "scenario") || readString(experiment, "scenario");
  if (["person_following", "phone_vision_guide", "gait_route", "campfire_memory"].includes(candidate)) {
    return candidate as RuntimeScenario;
  }
  return null;
}

function assertBrowserRuntimeSchema(job: DeviceJobRequest) {
  if (job.schema !== BROWSER_RUNTIME_JOB_SCHEMA) {
    throw new Error("스마트폰 런타임은 campfire.device-job.v3 작업만 시작할 수 있습니다. 설계기에서 작업 JSON을 다시 만드세요.");
  }
}

function jobField(job: DeviceJobRequest | null, key: string) {
  return job ? readString(asRecord(job), key) : "";
}

function shortHash(value: string) {
  return value ? `${value.slice(0, 10)}…${value.slice(-6)}` : "—";
}

function formatElapsed(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function jsonBlob(value: unknown) {
  return new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
}

export default function SmartphoneRuntimePage() {
  const [phase, setPhase] = useState<RuntimePhase>("loading");
  const [trustedJob, setTrustedJob] = useState<DeviceJobRequest | null>(null);
  const [job, setJob] = useState<DeviceJobRequest | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [designId, setDesignId] = useState("");
  const [goal, setGoal] = useState("");
  const [requestHash, setRequestHash] = useState("");
  const [sourceLabel, setSourceLabel] = useState("워크벤치 작업");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [sensorConsent, setSensorConsent] = useState(false);
  const [safetyConsent, setSafetyConsent] = useState(false);
  const [thirdPartySpeechConsent, setThirdPartySpeechConsent] = useState(false);
  const [browserSpeechEnabled, setBrowserSpeechEnabled] = useState(false);
  const [localHaptics, setLocalHaptics] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [transcriptReviewed, setTranscriptReviewed] = useState(false);
  const [forcedStopCode, setForcedStopCode] = useState<string | null>(null);
  const [frozenExecutionMode, setFrozenExecutionMode] = useState<ExecutionMode | null>(null);

  const [rosUrl, setRosUrl] = useState("ws://127.0.0.1:9090");
  const [rosState, setRosState] = useState<RosState>("disconnected");
  const [rosDataConsent, setRosDataConsent] = useState(false);
  const [rosSimulationAttested, setRosSimulationAttested] = useState(false);
  const [rosVibrationFeedback, setRosVibrationFeedback] = useState(false);
  const [rosSpeechFeedback, setRosSpeechFeedback] = useState(false);
  const [rosMessage, setRosMessage] = useState("연결 안 됨");

  const [elapsedMs, setElapsedMs] = useState(0);
  const [steps, setSteps] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [motionRatio, setMotionRatio] = useState(0);
  const [visionCenter, setVisionCenter] = useState({ x: 0, y: 0 });
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [sensorState, setSensorState] = useState({ camera: false, microphone: false, motion: false, location: false });
  const [evidenceBundle, setEvidenceBundle] = useState<Awaited<ReturnType<typeof createEvidenceArtifact>> | null>(null);
  const [receipt, setReceipt] = useState<Awaited<ReturnType<typeof createRuntimeReceipt>> | null>(null);
  const [busy, setBusy] = useState("");
  const [secureContext, setSecureContext] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previousFrameRef = useRef<Uint8Array | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const geoWatchRef = useRef<number | null>(null);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const rosConnectTimerRef = useRef<number | null>(null);
  const rosHeartbeatTimerRef = useRef<number | null>(null);
  const motionListenerRef = useRef<((event: DeviceMotionEvent) => void) | null>(null);
  const rosDataConsentRef = useRef(false);
  const rosVibrationFeedbackRef = useRef(false);
  const rosSpeechFeedbackRef = useRef(false);
  const rosSimulationAttestedRef = useRef(false);
  const simulationAttestedForRunRef = useRef(false);
  const frozenExecutionModeRef = useRef<ExecutionMode | null>(null);
  const interruptRunRef = useRef<(reason: string, reasonCode?: string) => void>(() => undefined);
  const stopSensorResourcesRef = useRef<() => void>(() => undefined);
  const localHapticsRef = useRef(false);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const startAttemptRef = useRef(0);
  const importingRef = useRef(false);
  const sensorConsentRef = useRef(false);
  const safetyConsentRef = useRef(false);
  const runGenerationRef = useRef(0);
  const jobRef = useRef<DeviceJobRequest | null>(null);
  const rosStreamedRef = useRef(false);
  const rosDroppedRef = useRef(0);
  const rosHeartbeatFailuresRef = useRef(0);
  const currentRunIdRef = useRef("");
  const lastRosImuSentRef = useRef(0);
  const lastRosFeedbackAtRef = useRef(0);
  const lastCameraAnalysisRef = useRef(0);
  const lastRoutePointRef = useRef<RoutePoint | null>(null);
  const motionSeenRef = useRef(false);
  const transcriptRef = useRef("");
  const transcriptReviewedRef = useRef(false);
  const forcedStopCodeRef = useRef<string | null>(null);
  const speechEndPromiseRef = useRef<Promise<void> | null>(null);
  const speechEndResolveRef = useRef<(() => void) | null>(null);
  const runningRef = useRef(false);
  const startedAtRef = useRef("");
  const startedClockRef = useRef(0);
  const lastStepAtRef = useRef(0);
  const lastImuStoredRef = useRef(0);
  const lastVisionStoredRef = useRef(0);
  const lastHapticRef = useRef(0);
  const imuPointsRef = useRef<ImuPoint[]>([]);
  const routePointsRef = useRef<RoutePoint[]>([]);
  const visionPointsRef = useRef<VisionPoint[]>([]);
  const metricsRef = useRef({ steps: 0, distanceM: 0, motionRatio: 0, maxAcceleration: 0 });

  const scenario = useMemo(() => scenarioFromJob(job), [job]);
  const needsCamera = scenario === "person_following" || scenario === "phone_vision_guide";
  const needsMotion = scenario === "gait_route";
  const needsLocation = scenario === "gait_route";
  const needsMicrophone = scenario === "campfire_memory";
  const cameraWillStreamToRos = needsCamera && rosState === "connected" && rosDataConsent;
  const proposedExecutionMode: ExecutionMode = cameraWillStreamToRos ? "ROS2_SIMULATION" : "PHONE_CLOSED_LOOP";
  const executionMode = frozenExecutionMode ?? proposedExecutionMode;
  const canStart = phase === "ready" && Boolean(job && scenario && sensorConsent && safetyConsent)
    && !busy
    && job?.schema === BROWSER_RUNTIME_JOB_SCHEMA
    && (scenario !== "person_following" || proposedExecutionMode === "ROS2_SIMULATION")
    && (proposedExecutionMode !== "ROS2_SIMULATION" || rosSimulationAttested);
  const configurationLocked = phase === "running" || ["start", "stop", "import"].includes(busy);

  useEffect(() => { rosDataConsentRef.current = rosDataConsent; }, [rosDataConsent]);
  useEffect(() => { rosVibrationFeedbackRef.current = rosVibrationFeedback; }, [rosVibrationFeedback]);
  useEffect(() => { rosSpeechFeedbackRef.current = rosSpeechFeedback; }, [rosSpeechFeedback]);
  useEffect(() => { rosSimulationAttestedRef.current = rosSimulationAttested; }, [rosSimulationAttested]);
  useEffect(() => { sensorConsentRef.current = sensorConsent; }, [sensorConsent]);
  useEffect(() => { safetyConsentRef.current = safetyConsent; }, [safetyConsent]);
  useEffect(() => { localHapticsRef.current = localHaptics; }, [localHaptics]);
  useEffect(() => { jobRef.current = job; }, [job]);

  function clearMessage() {
    setError("");
    setNotice("");
  }

  function interruptRun(reason: string, reasonCode = "SENSOR_INTERRUPTED") {
    if (!runningRef.current) return;
    forcedStopCodeRef.current = reasonCode;
    setForcedStopCode(reasonCode);
    void stopRun().then(() => {
      if (mountedRef.current) setError(reason);
    });
  }

  useEffect(() => {
    interruptRunRef.current = interruptRun;
    stopSensorResourcesRef.current = stopSensorResources;
  });

  useEffect(() => {
    const interruptForBackground = () => {
      if (startingRef.current) {
        startAttemptRef.current += 1;
        stopSensorResourcesRef.current();
        startingRef.current = false;
        if (mountedRef.current) {
          setBusy("");
          setPhase("ready");
          setError("화면이 백그라운드로 전환되어 센서 시작을 취소했습니다.");
        }
        return;
      }
      if (!runningRef.current) return;
      interruptRunRef.current(
        "화면이 백그라운드로 전환되어 센서 관찰을 즉시 중단했습니다.",
        "BACKGROUND_TRANSITION",
      );
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") interruptForBackground();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", interruptForBackground);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", interruptForBackground);
    };
  }, []);

  function sendRos(topic: (typeof ROS_TOPICS)[keyof typeof ROS_TOPICS], message: JsonRecord) {
    const socket = socketRef.current;
    if (!rosDataConsentRef.current || socket?.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > 262_144) {
      rosDroppedRef.current += 1;
      return false;
    }
    socket.send(JSON.stringify(rosPublish(topic, message)));
    rosStreamedRef.current = true;
    return true;
  }

  function sendRuntimeEvent(state: "RUNNING" | "STOPPED" | "FAILED" | "ABORTED") {
    const activeJob = jobRef.current;
    const activeExecutionMode = frozenExecutionModeRef.current;
    if (!activeJob || !currentRunIdRef.current || !activeExecutionMode) return false;
    return sendRos(ROS_TOPICS.runtime, {
      data: JSON.stringify({
        schema: "campfire.phone-runtime.v1",
        job_id: jobField(activeJob, "job_id"),
        run_id: currentRunIdRef.current,
        execution_mode: activeExecutionMode,
        state,
        ...(state === "RUNNING" ? { lease_ms: 3_000 } : { lease_ms: 0 }),
      }),
    });
  }

  async function acceptJob(candidate: unknown, trusted: DeviceJobRequest, label: string) {
    if (runningRef.current || phase === "running") throw new Error("센서 관찰을 중단한 뒤 작업을 바꾸세요.");
    const validated = await validateRuntimeJob(asRecord(candidate), trusted);
    assertBrowserRuntimeSchema(validated.job);
    if (!mountedRef.current) return;
    if (startingRef.current || runningRef.current) throw new Error("센서 시작이 진행되어 작업 JSON 교체를 취소했습니다.");
    const validatedScenario = scenarioFromJob(validated.job);
    if (!validatedScenario) throw new Error("이 런타임이 지원하는 스마트폰 시나리오가 아닙니다.");
    setJob(validated.job);
    jobRef.current = validated.job;
    setRequestHash(validated.requestHashSha256);
    setSourceLabel(label);
    if (socketRef.current) disconnectRos("작업이 바뀌어 ROS 연결을 닫았습니다.");
    setRosSimulationAttested(false);
    setTranscript("");
    transcriptRef.current = "";
    setTranscriptReviewed(false);
    transcriptReviewedRef.current = false;
    setForcedStopCode(null);
    forcedStopCodeRef.current = null;
    setFrozenExecutionMode(null);
    frozenExecutionModeRef.current = null;
    setPhase("ready");
    setEvidenceBundle(null);
    setReceipt(null);
  }

  useEffect(() => {
    const controller = new AbortController();
    const requestedSession = new URLSearchParams(window.location.search).get("session");
    const suffix = requestedSession ? `?session=${encodeURIComponent(requestedSession)}` : "";
    fetch(`/api/designer${suffix}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as DesignerResponse;
        if (!response.ok) throw new Error(payload.error ?? "워크벤치 작업을 불러오지 못했습니다.");
        return payload;
      })
      .then(async (payload) => {
        const active = payload.active;
        if (!active?.job?.request) throw new Error("먼저 설계기에서 확인을 마치고 작업 JSON을 만드세요.");
        if (active.job.status !== "REQUESTED") throw new Error("이 작업에는 이미 영수증이 있거나 현재 실행할 수 없습니다.");
        const storedRequest = asRecord(active.job.request);
        const checked = await validateRuntimeJob(storedRequest, storedRequest);
        assertBrowserRuntimeSchema(checked.job);
        if (!mountedRef.current) return;
        setTrustedJob(checked.job);
        setJob(checked.job);
        jobRef.current = checked.job;
        setSessionId(active.sessionId);
        setDesignId(active.plan.id);
        setGoal(active.plan.goal);
        setRequestHash(checked.requestHashSha256);
        setPhase("ready");
      })
      .catch((cause: unknown) => {
        if (!mountedRef.current) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "워크벤치 작업을 불러오지 못했습니다.");
        setPhase("empty");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (phase !== "running") return;
    const timer = window.setInterval(() => {
      setElapsedMs(performance.now() - startedClockRef.current);
      setSteps(metricsRef.current.steps);
      setDistanceM(metricsRef.current.distanceM);
      setMotionRatio(metricsRef.current.motionRatio);
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    mountedRef.current = true;
    const secureContextTimer = window.setTimeout(() => {
      if (mountedRef.current) setSecureContext(window.isSecureContext);
    }, 0);
    return () => {
      window.clearTimeout(secureContextTimer);
      mountedRef.current = false;
      runGenerationRef.current += 1;
      runningRef.current = false;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (cameraFrameRef.current !== null) cancelAnimationFrame(cameraFrameRef.current);
      if (geoWatchRef.current !== null) navigator.geolocation.clearWatch(geoWatchRef.current);
      if (motionListenerRef.current) window.removeEventListener("devicemotion", motionListenerRef.current);
      if (rosConnectTimerRef.current !== null) window.clearTimeout(rosConnectTimerRef.current);
      if (rosHeartbeatTimerRef.current !== null) window.clearInterval(rosHeartbeatTimerRef.current);
      try { speechRef.current?.stop(); } catch { /* Recognition may already be stopped. */ }
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close(1000, "page_closed");
    };
  }, []);

  async function importJob(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (runningRef.current) {
      setError("센서 관찰을 중단한 뒤 작업 JSON을 바꾸세요.");
      return;
    }
    if (startingRef.current || importingRef.current) {
      setError("진행 중인 작업을 마친 뒤 JSON을 바꾸세요.");
      return;
    }
    importingRef.current = true;
    setBusy("import");
    clearMessage();
    try {
      if (!trustedJob) throw new Error("먼저 이 계정의 워크벤치 작업을 불러와야 합니다.");
      if (file.size <= 0 || file.size > MAX_JOB_BYTES) throw new Error("작업 JSON은 256KB 이하여야 합니다.");
      const candidate = JSON.parse(await file.text()) as unknown;
      await acceptJob(candidate, trustedJob, file.name);
      if (!mountedRef.current) return;
      setNotice("서버에 저장된 작업과 해시·작업 키가 일치합니다.");
    } catch (cause) {
      if (!mountedRef.current) return;
      setError(cause instanceof Error ? cause.message : "작업 JSON을 확인하지 못했습니다.");
    } finally {
      importingRef.current = false;
      if (mountedRef.current) setBusy("");
    }
  }

  function handleRosFeedback(payload: unknown) {
    const envelope = asRecord(payload);
    if (envelope.op !== "publish" || envelope.topic !== ROS_TOPICS.feedback.topic) return;
    const message = asRecord(envelope.msg);
    const data = typeof message.data === "string" ? message.data.trim() : "";
    if (!data || data.length > 1_024) return;
    try {
      const status = asRecord(JSON.parse(data) as unknown);
      const allowedEvents = new Set(["READY", "RUNNING", "STOPPED", "REJECTED"]);
      const event = readString(status, "event").toLocaleUpperCase("en-US");
      if (status.schema === "campfire.ros-feedback.v1" && status.simulation_only === true && allowedEvents.has(event)) {
        setRosMessage(`시뮬레이터 상태: ${event}`);
        if (event === "REJECTED" && runningRef.current && frozenExecutionModeRef.current === "ROS2_SIMULATION") {
          interruptRun("ROS 시뮬레이터가 런타임 또는 비전 관찰을 거부해 중단했습니다.", "ROS_OBSERVATION_REJECTED");
        }
        return;
      }
    } catch { /* Command tokens are handled below. */ }
    if (!runningRef.current) return;
    const expectedPrefix = `${jobField(jobRef.current, "job_id")}:`;
    if (!data.startsWith(expectedPrefix)) return;
    const command = data.slice(expectedPrefix.length);
    const now = performance.now();
    if (now - lastRosFeedbackAtRef.current < 750) return;
    lastRosFeedbackAtRef.current = now;
    if (command === "VIBRATE_SHORT" && rosVibrationFeedbackRef.current) {
      navigator.vibrate?.(120);
      setRosMessage("시뮬레이터 피드백: 짧은 진동");
      return;
    }
    if (command === "VIBRATE_STOP" && rosVibrationFeedbackRef.current) {
      navigator.vibrate?.(0);
      setRosMessage("시뮬레이터 피드백: 진동 중지");
      return;
    }
    if (command.startsWith("SPEAK:") && rosSpeechFeedbackRef.current) {
      const phrase = command.slice(6).trim();
      if (phrase.length > 0 && phrase.length <= 80 && /^[\p{L}\p{N}\s.,!?'-]+$/u.test(phrase) && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(phrase));
        setRosMessage("시뮬레이터 피드백: 기기 음성");
        return;
      }
    }
    setRosMessage("허용 목록 밖의 피드백을 무시했습니다.");
  }

  function disconnectRos(message = "연결을 닫았습니다.") {
    const socket = socketRef.current;
    socketRef.current = null;
    if (rosConnectTimerRef.current !== null) window.clearTimeout(rosConnectTimerRef.current);
    rosConnectTimerRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "operator_disconnect");
    rosSimulationAttestedRef.current = false;
    setRosSimulationAttested(false);
    setRosState("disconnected");
    setRosMessage(message);
  }

  function connectRos() {
    clearMessage();
    if (!job || !scenario) {
      setError("먼저 실행할 워크벤치 작업을 불러오세요.");
      return;
    }
    if (!rosDataConsent) {
      setError("ROS로 선택 센서 관찰과 검토 전사를 전송하는 데 먼저 동의하세요.");
      return;
    }
    try {
      const url = new URL(rosUrl);
      if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error("rosbridge 주소는 ws:// 또는 wss://여야 합니다.");
      if (window.location.protocol === "https:" && url.protocol !== "wss:") {
        throw new Error("HTTPS 사이트에서는 브라우저 보안상 wss:// rosbridge만 연결할 수 있습니다.");
      }
      disconnectRos("새 연결 준비 중");
      setRosState("connecting");
      setRosMessage("rosbridge 응답 대기 중");
      const socket = new WebSocket(url.toString());
      socketRef.current = socket;
      rosConnectTimerRef.current = window.setTimeout(() => {
        if (socketRef.current !== socket || socket.readyState === WebSocket.OPEN) return;
        socketRef.current = null;
        rosSimulationAttestedRef.current = false;
        setRosSimulationAttested(false);
        socket.close();
        setRosState("error");
        setRosMessage("8초 안에 연결되지 않았습니다.");
      }, 8_000);
      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        if (rosConnectTimerRef.current !== null) window.clearTimeout(rosConnectTimerRef.current);
        rosConnectTimerRef.current = null;
        const advertisements = [
          rosAdvertise(ROS_TOPICS.imu),
          rosAdvertise(ROS_TOPICS.navsat),
          rosAdvertise(ROS_TOPICS.vision),
          rosAdvertise(ROS_TOPICS.transcript),
          rosAdvertise(ROS_TOPICS.runtime),
          rosSubscribe(ROS_TOPICS.feedback),
        ];
        advertisements.forEach((message) => socket.send(JSON.stringify(message)));
        setRosState("connected");
        setRosMessage("토픽 5개 발행 · 피드백 1개 구독");
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string" || event.data.length > 4_096) return;
        try { handleRosFeedback(JSON.parse(event.data) as unknown); } catch { /* Ignore non-JSON frames. */ }
      };
      socket.onerror = () => {
        if (socketRef.current !== socket) return;
        setRosState("error");
        setRosMessage("연결 오류 · 주소와 인증서를 확인하세요.");
      };
      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        if (rosConnectTimerRef.current !== null) window.clearTimeout(rosConnectTimerRef.current);
        rosConnectTimerRef.current = null;
        socketRef.current = null;
        setRosState((current) => current === "error" ? current : "disconnected");
        if (runningRef.current && frozenExecutionModeRef.current === "ROS2_SIMULATION") {
          interruptRun("ROS 연결이 끊겨 시뮬레이션 관찰을 즉시 중단했습니다.", "ROS_CONNECTION_LOST");
        }
      };
    } catch (cause) {
      setRosState("error");
      setError(cause instanceof Error ? cause.message : "rosbridge에 연결하지 못했습니다.");
    }
  }

  function recordVisionPoint(point: VisionPoint) {
    if (visionPointsRef.current.length < MAX_VISION_POINTS) visionPointsRef.current.push(point);
    if (frozenExecutionModeRef.current !== "ROS2_SIMULATION") return;
    sendRos(ROS_TOPICS.vision, {
      data: JSON.stringify({
        schema: "campfire.phone-vision.v1",
        job_id: jobField(jobRef.current, "job_id"),
        run_id: currentRunIdRef.current,
        captured_at: point.captured_at,
        motion: {
          centroid: { x: (point.centroid_x + 1) / 2, y: (point.centroid_y + 1) / 2 },
          confidence: Math.min(1, point.motion_ratio / 0.08),
          moving: point.motion_ratio >= 0.01,
          tracker: point.tracker,
          identity_inferred: false,
        },
      }),
    });
  }

  function processCameraFrame() {
    if (!runningRef.current || !videoRef.current) return;
    const now = performance.now();
    if (now - lastCameraAnalysisRef.current < 80) {
      cameraFrameRef.current = requestAnimationFrame(processCameraFrame);
      return;
    }
    lastCameraAnalysisRef.current = now;
    const video = videoRef.current;
    const analysis = analysisCanvasRef.current ?? document.createElement("canvas");
    analysisCanvasRef.current = analysis;
    analysis.width = 64;
    analysis.height = 36;
    const context = analysis.getContext("2d", { willReadFrequently: true });
    const overlay = overlayRef.current;
    const overlayContext = overlay?.getContext("2d");
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && context && overlay && overlayContext) {
      context.drawImage(video, 0, 0, analysis.width, analysis.height);
      const rgba = context.getImageData(0, 0, analysis.width, analysis.height).data;
      const grayscale = new Uint8Array(analysis.width * analysis.height);
      let changed = 0;
      let xTotal = 0;
      let yTotal = 0;
      const previous = previousFrameRef.current;
      for (let index = 0; index < grayscale.length; index += 1) {
        const offset = index * 4;
        const value = Math.round(rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114);
        grayscale[index] = value;
        if (previous && Math.abs(value - previous[index]) > 28) {
          changed += 1;
          xTotal += index % analysis.width;
          yTotal += Math.floor(index / analysis.width);
        }
      }
      previousFrameRef.current = grayscale;
      const ratio = changed / grayscale.length;
      const normalizedX = changed ? (xTotal / changed / (analysis.width - 1)) * 2 - 1 : 0;
      const normalizedY = changed ? (yTotal / changed / (analysis.height - 1)) * 2 - 1 : 0;
      metricsRef.current.motionRatio = ratio;

      const overlayWidth = video.videoWidth || 640;
      const overlayHeight = video.videoHeight || 360;
      if (overlay.width !== overlayWidth) overlay.width = overlayWidth;
      if (overlay.height !== overlayHeight) overlay.height = overlayHeight;
      overlayContext.clearRect(0, 0, overlay.width, overlay.height);
      if (changed > 12) {
        const x = (normalizedX + 1) * 0.5 * overlay.width;
        const y = (normalizedY + 1) * 0.5 * overlay.height;
        overlayContext.strokeStyle = "#43d7c8";
        overlayContext.lineWidth = Math.max(2, overlay.width / 320);
        overlayContext.beginPath();
        overlayContext.arc(x, y, Math.max(22, overlay.width * 0.045), 0, Math.PI * 2);
        overlayContext.moveTo(x - 42, y);
        overlayContext.lineTo(x + 42, y);
        overlayContext.moveTo(x, y - 42);
        overlayContext.lineTo(x, y + 42);
        overlayContext.stroke();
      }
      if (now - lastVisionStoredRef.current >= 500) {
        setVisionCenter({ x: normalizedX, y: normalizedY });
        const point: VisionPoint = {
          captured_at: new Date().toISOString(),
          centroid_x: Number(normalizedX.toFixed(4)),
          centroid_y: Number(normalizedY.toFixed(4)),
          motion_ratio: Number(ratio.toFixed(5)),
          tracker: "frame_difference",
          identity_inferred: false,
        };
        recordVisionPoint(point);
        lastVisionStoredRef.current = now;
        if (localHapticsRef.current && ratio > 0.035 && Math.abs(normalizedX) > 0.55 && now - lastHapticRef.current > 1_200) {
          navigator.vibrate?.(70);
          lastHapticRef.current = now;
        }
      }
    }
    cameraFrameRef.current = requestAnimationFrame(processCameraFrame);
  }

  function handleMotion(event: DeviceMotionEvent) {
    if (!runningRef.current) return;
    const acceleration = event.acceleration ?? event.accelerationIncludingGravity;
    if (!acceleration) return;
    const x = acceleration.x ?? 0;
    const y = acceleration.y ?? 0;
    const z = acceleration.z ?? 0;
    const rawMagnitude = Math.sqrt(x * x + y * y + z * z);
    const magnitude = event.acceleration ? rawMagnitude : Math.abs(rawMagnitude - 9.81);
    if (!motionSeenRef.current) {
      motionSeenRef.current = true;
      setSensorState((current) => ({ ...current, motion: true }));
    }
    metricsRef.current.maxAcceleration = Math.max(metricsRef.current.maxAcceleration, magnitude);
    const now = performance.now();
    if (magnitude > 1.65 && now - lastStepAtRef.current > 320) {
      metricsRef.current.steps += 1;
      lastStepAtRef.current = now;
    }
    const rotation = event.rotationRate;
    const degreesToRadians = Math.PI / 180;
    const point: ImuPoint = {
      captured_at: new Date().toISOString(),
      acceleration_m_s2: { x, y, z },
      angular_velocity_rad_s: {
        x: (rotation?.beta ?? 0) * degreesToRadians,
        y: (rotation?.gamma ?? 0) * degreesToRadians,
        z: (rotation?.alpha ?? 0) * degreesToRadians,
      },
    };
    if (now - lastImuStoredRef.current >= 100 && imuPointsRef.current.length < MAX_IMU_POINTS) {
      imuPointsRef.current.push(point);
      lastImuStoredRef.current = now;
    }
    if (now - lastRosImuSentRef.current >= 50) {
      sendRos(ROS_TOPICS.imu, {
        header: { stamp: rosStamp(), frame_id: "phone" },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        orientation_covariance: UNKNOWN_ORIENTATION_COVARIANCE,
        angular_velocity: point.angular_velocity_rad_s,
        angular_velocity_covariance: ZERO_COVARIANCE,
        linear_acceleration: point.acceleration_m_s2,
        linear_acceleration_covariance: ZERO_COVARIANCE,
      });
      lastRosImuSentRef.current = now;
    }
  }

  function handlePosition(position: GeolocationPosition) {
    if (!runningRef.current) return;
    const point: RoutePoint = {
      captured_at: new Date(position.timestamp).toISOString(),
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy_m: position.coords.accuracy,
    };
    const previous = lastRoutePointRef.current;
    if (previous) metricsRef.current.distanceM += haversineMeters(previous, point);
    lastRoutePointRef.current = point;
    if (routePointsRef.current.length < MAX_ROUTE_POINTS) routePointsRef.current.push(point);
    setGpsAccuracy(point.accuracy_m);
    setSensorState((current) => current.location ? current : { ...current, location: true });
    sendRos(ROS_TOPICS.navsat, {
      header: { stamp: rosStamp(position.timestamp), frame_id: "phone_gps" },
      status: { status: 0, service: 1 },
      latitude: point.latitude,
      longitude: point.longitude,
      altitude: position.coords.altitude ?? 0,
      position_covariance: [point.accuracy_m ** 2, 0, 0, 0, point.accuracy_m ** 2, 0, 0, 0, 0],
      position_covariance_type: 2,
    });
  }

  async function requestMotionPermission(generation: number) {
    const motion = window.DeviceMotionEvent as typeof DeviceMotionEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
    if (!motion) throw new Error("이 브라우저는 DeviceMotion을 지원하지 않습니다.");
    if (motion.requestPermission && await motion.requestPermission() !== "granted") throw new Error("모션 센서 권한이 필요합니다.");
    if (!mountedRef.current || runGenerationRef.current !== generation) throw new Error("RUN_CANCELLED");
    const listener = (event: DeviceMotionEvent) => handleMotion(event);
    motionListenerRef.current = listener;
    window.addEventListener("devicemotion", listener);
  }

  function startSpeechRecognition() {
    if (!browserSpeechEnabled || !thirdPartySpeechConsent) return;
    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setNotice("이 브라우저에는 음성 인식 기능이 없어 수동 전사만 사용합니다.");
      return;
    }
    const recognition = new Constructor();
    speechEndPromiseRef.current = new Promise<void>((resolve) => {
      speechEndResolveRef.current = resolve;
    });
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "ko-KR";
    recognition.onresult = (event) => {
      if (!mountedRef.current) return;
      const additions: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal && result[0]?.transcript) additions.push(result[0].transcript.trim());
      }
      if (additions.length) setTranscript((current) => {
        const next = `${current}${current ? "\n" : ""}${additions.join("\n")}`.slice(0, 12_000);
        transcriptRef.current = next;
        transcriptReviewedRef.current = false;
        setTranscriptReviewed(false);
        return next;
      });
    };
    recognition.onerror = () => {
      if (mountedRef.current) setNotice("브라우저 음성 인식이 중단되었습니다. 수동 전사는 계속 사용할 수 있습니다.");
    };
    recognition.onend = () => {
      speechEndResolveRef.current?.();
      speechEndResolveRef.current = null;
    };
    speechRef.current = recognition;
    try {
      recognition.start();
    } catch {
      speechRef.current = null;
      speechEndResolveRef.current?.();
      speechEndResolveRef.current = null;
      setNotice("브라우저 음성 인식을 시작하지 못해 수동 전사만 사용합니다.");
    }
  }

  function resetRunBuffers() {
    imuPointsRef.current = [];
    routePointsRef.current = [];
    visionPointsRef.current = [];
    previousFrameRef.current = null;
    lastStepAtRef.current = 0;
    lastImuStoredRef.current = 0;
    lastVisionStoredRef.current = 0;
    lastRosImuSentRef.current = 0;
    lastRosFeedbackAtRef.current = 0;
    lastCameraAnalysisRef.current = 0;
    lastRoutePointRef.current = null;
    motionSeenRef.current = false;
    rosStreamedRef.current = false;
    rosDroppedRef.current = 0;
    rosHeartbeatFailuresRef.current = 0;
    currentRunIdRef.current = "";
    simulationAttestedForRunRef.current = false;
    frozenExecutionModeRef.current = null;
    if (rosHeartbeatTimerRef.current !== null) window.clearInterval(rosHeartbeatTimerRef.current);
    rosHeartbeatTimerRef.current = null;
    setForcedStopCode(null);
    forcedStopCodeRef.current = null;
    setFrozenExecutionMode(null);
    speechEndResolveRef.current?.();
    speechEndResolveRef.current = null;
    speechEndPromiseRef.current = null;
    metricsRef.current = { steps: 0, distanceM: 0, motionRatio: 0, maxAcceleration: 0 };
    setElapsedMs(0);
    setSteps(0);
    setDistanceM(0);
    setMotionRatio(0);
    setVisionCenter({ x: 0, y: 0 });
    setGpsAccuracy(null);
    setSensorState({ camera: false, microphone: false, motion: false, location: false });
    setEvidenceBundle(null);
    setReceipt(null);
  }

  async function startRun() {
    if (startingRef.current || importingRef.current) return;
    clearMessage();
    if (!job || !scenario) {
      setError("먼저 실행할 워크벤치 작업을 불러오세요.");
      return;
    }
    if (job.schema !== BROWSER_RUNTIME_JOB_SCHEMA) {
      setError("스마트폰 런타임은 campfire.device-job.v3 작업만 시작할 수 있습니다. 설계기에서 작업 JSON을 다시 만드세요.");
      return;
    }
    if (!canStart) {
      setError(scenario === "person_following" && rosState !== "connected"
        ? "사람 추종을 시작하려면 ROS 2 시뮬레이터 연결이 필요합니다."
        : proposedExecutionMode === "ROS2_SIMULATION" && !rosSimulationAttested
          ? "rosbridge 뒤에 물리 제어기가 없고 시뮬레이터만 연결되었음을 먼저 확인하세요."
          : "작업과 동의 항목을 먼저 확인하세요.");
      return;
    }
    const requestedExecutionMode = proposedExecutionMode;
    const startAttempt = ++startAttemptRef.current;
    setBusy("start");
    startingRef.current = true;
    resetRunBuffers();
    const generation = ++runGenerationRef.current;
    let initialPosition: GeolocationPosition | null = null;
    try {
      if (!window.isSecureContext && window.location.hostname !== "localhost") {
        throw new Error("카메라·위치 센서는 HTTPS 보안 연결에서 실행하세요.");
      }
      if (needsCamera || needsMicrophone) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: needsCamera ? { facingMode: { ideal: "environment" } } : false,
          audio: needsMicrophone,
        });
        if (!mountedRef.current || runGenerationRef.current !== generation) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error("RUN_CANCELLED");
        }
        mediaStreamRef.current = stream;
        stream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => {
          if (mountedRef.current && runGenerationRef.current === generation) {
            setSensorState((current) => ({ ...current, camera: false }));
            interruptRun("카메라 권한이나 스트림이 끝나 관찰을 중단했습니다.");
          }
        }));
        stream.getAudioTracks().forEach((track) => track.addEventListener("ended", () => {
          if (mountedRef.current && runGenerationRef.current === generation) {
            setSensorState((current) => ({ ...current, microphone: false }));
            interruptRun("마이크 권한이나 스트림이 끝나 관찰을 중단했습니다.");
          }
        }));
        setSensorState((current) => ({
          ...current,
          camera: stream.getVideoTracks().length > 0,
          microphone: stream.getAudioTracks().length > 0,
        }));
        if (needsCamera && videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          if (!mountedRef.current || runGenerationRef.current !== generation) throw new Error("RUN_CANCELLED");
        }
      }
      if (needsMotion) await requestMotionPermission(generation);
      if (!mountedRef.current || runGenerationRef.current !== generation) throw new Error("RUN_CANCELLED");
      if (needsLocation) {
        if (!navigator.geolocation) throw new Error("이 브라우저는 위치 센서를 지원하지 않습니다.");
        initialPosition = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(
          resolve,
          (positionError) => reject(new Error(`위치 권한 또는 첫 좌표를 확인하지 못했습니다: ${positionError.message}`)),
          { enableHighAccuracy: true, maximumAge: 2_000, timeout: 15_000 },
        ));
        if (!mountedRef.current || runGenerationRef.current !== generation) throw new Error("RUN_CANCELLED");
        geoWatchRef.current = navigator.geolocation.watchPosition(
          handlePosition,
          (positionError) => {
            setSensorState((current) => ({ ...current, location: false }));
            interruptRun(`위치 관찰이 중단되었습니다: ${positionError.message}`);
          },
          { enableHighAccuracy: true, maximumAge: 2_000, timeout: 15_000 },
        );
      }
      if (!sensorConsentRef.current || !safetyConsentRef.current) {
        throw new Error("센서 수집 또는 안전 확인이 철회되어 시작을 취소했습니다.");
      }
      if (needsCamera && !mediaStreamRef.current?.getVideoTracks().some((track) => track.readyState === "live")) {
        throw new Error("카메라 스트림이 시작 전에 종료되었습니다.");
      }
      if (needsMicrophone && !mediaStreamRef.current?.getAudioTracks().some((track) => track.readyState === "live")) {
        throw new Error("마이크 스트림이 시작 전에 종료되었습니다.");
      }
      const executionModeAtStart: ExecutionMode = needsCamera
        && socketRef.current?.readyState === WebSocket.OPEN
        && rosDataConsentRef.current
        ? "ROS2_SIMULATION"
        : "PHONE_CLOSED_LOOP";
      if (executionModeAtStart !== requestedExecutionMode) {
        throw new Error("권한을 확인하는 동안 ROS 연결 상태가 바뀌어 시작을 취소했습니다. 실행 방식을 다시 확인하세요.");
      }
      if (scenario === "person_following" && executionModeAtStart !== "ROS2_SIMULATION") {
        throw new Error("사람 추종은 ROS 2 시뮬레이션 연결에서만 시작할 수 있습니다.");
      }
      if (executionModeAtStart === "ROS2_SIMULATION" && !rosSimulationAttestedRef.current) {
        throw new Error("ROS 시뮬레이션 사용자 확인이 바뀌어 시작을 취소했습니다.");
      }
      if (!mountedRef.current || runGenerationRef.current !== generation) throw new Error("RUN_CANCELLED");
      if (document.visibilityState !== "visible") {
        throw new Error("화면이 백그라운드 상태여서 센서 실행을 시작하지 않았습니다.");
      }
      currentRunIdRef.current = `run:${crypto.randomUUID().replaceAll("-", "")}`;
      frozenExecutionModeRef.current = executionModeAtStart;
      setFrozenExecutionMode(executionModeAtStart);
      simulationAttestedForRunRef.current = executionModeAtStart === "ROS2_SIMULATION" && rosSimulationAttestedRef.current;
      runningRef.current = true;
      startedAtRef.current = new Date().toISOString();
      startedClockRef.current = performance.now();
      setPhase("running");
      if (initialPosition) handlePosition(initialPosition);
      if (needsCamera) cameraFrameRef.current = requestAnimationFrame(processCameraFrame);
      if (needsMicrophone) startSpeechRecognition();
      const runtimePublished = sendRuntimeEvent("RUNNING");
      if (executionModeAtStart === "ROS2_SIMULATION" && !runtimePublished) throw new Error("ROS 실행 임대를 시작하지 못했습니다.");
      if (runtimePublished) {
        rosHeartbeatTimerRef.current = window.setInterval(() => {
          if (!runningRef.current) return;
          if (sendRuntimeEvent("RUNNING")) {
            rosHeartbeatFailuresRef.current = 0;
          } else {
            rosHeartbeatFailuresRef.current += 1;
            if (frozenExecutionModeRef.current === "ROS2_SIMULATION" && rosHeartbeatFailuresRef.current >= 2) {
              interruptRun("ROS 실행 임대 갱신에 실패해 시뮬레이션 관찰을 중단했습니다.", "ROS_LEASE_RENEWAL_FAILED");
            }
          }
        }, 1_000);
      }
      setNotice(executionModeAtStart === "ROS2_SIMULATION"
        ? "카메라의 움직임 중심을 ROS 2 시뮬레이터로 보냅니다. 사람 신원은 식별하지 않습니다."
        : "센서 관찰을 시작했습니다. 원본 영상·음성은 저장하거나 사이트로 올리지 않습니다.");
    } catch (cause) {
      // A background transition can cancel this attempt and allow a new one.
      // Never let the stale attempt tear down resources owned by the newer run.
      if (startAttemptRef.current !== startAttempt) return;
      stopSensorResources();
      frozenExecutionModeRef.current = null;
      if (mountedRef.current) setFrozenExecutionMode(null);
      if (!mountedRef.current || (cause instanceof Error && cause.message === "RUN_CANCELLED")) return;
      setError(cause instanceof Error ? cause.message : "센서 관찰을 시작하지 못했습니다.");
      setPhase("ready");
    } finally {
      if (startAttemptRef.current === startAttempt) {
        startingRef.current = false;
        if (mountedRef.current) setBusy("");
      }
    }
  }

  function stopSensorResources() {
    runGenerationRef.current += 1;
    runningRef.current = false;
    if (motionListenerRef.current) window.removeEventListener("devicemotion", motionListenerRef.current);
    motionListenerRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (cameraFrameRef.current !== null) cancelAnimationFrame(cameraFrameRef.current);
    cameraFrameRef.current = null;
    if (geoWatchRef.current !== null) navigator.geolocation.clearWatch(geoWatchRef.current);
    geoWatchRef.current = null;
    try { speechRef.current?.stop(); } catch { speechEndResolveRef.current?.(); }
    speechRef.current = null;
    if (rosHeartbeatTimerRef.current !== null) window.clearInterval(rosHeartbeatTimerRef.current);
    rosHeartbeatTimerRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    navigator.vibrate?.(0);
    if (mountedRef.current) setSensorState({ camera: false, microphone: false, motion: false, location: false });
  }

  async function stopRun() {
    if (!runningRef.current || !job || !scenario) return;
    const runExecutionMode = frozenExecutionModeRef.current;
    if (!runExecutionMode) {
      forcedStopCodeRef.current = "EXECUTION_MODE_MISSING";
      setForcedStopCode("EXECUTION_MODE_MISSING");
      stopSensorResources();
      setPhase("stopped");
      setError("고정된 실행 방식을 확인할 수 없어 관찰을 안전 중단했습니다.");
      return;
    }
    setBusy("stop");
    clearMessage();
    const stoppedAt = new Date().toISOString();
    const durationMs = Math.max(0, performance.now() - startedClockRef.current);
    const speechRecognitionAtStop = speechRef.current;
    const speechEnded = speechEndPromiseRef.current;
    sendRuntimeEvent(forcedStopCodeRef.current ? "ABORTED" : "STOPPED");
    stopSensorResources();
    if (speechEnded) await Promise.race([
      speechEnded,
      new Promise<void>((resolve) => window.setTimeout(resolve, 1_500)),
    ]);
    if (speechRecognitionAtStop) {
      speechRecognitionAtStop.onresult = null;
      speechRecognitionAtStop.onerror = null;
      speechRecognitionAtStop.onend = null;
    }
    if (!mountedRef.current) return;
    const transcriptSnapshot = transcriptRef.current.trim();
    const reviewedTranscript = transcriptReviewedRef.current ? transcriptSnapshot : "";
    setElapsedMs(durationMs);
    setSteps(metricsRef.current.steps);
    setDistanceM(metricsRef.current.distanceM);
    try {
      const observations: RuntimeEvidence["observations"] = [
        ...imuPointsRef.current.map((point) => ({
          kind: "imu",
          observed_at: point.captured_at,
          topic: ROS_TOPICS.imu.topic,
          payload: {
            acceleration_m_s2: point.acceleration_m_s2,
            angular_velocity_rad_s: point.angular_velocity_rad_s,
          },
        })),
        ...routePointsRef.current.map((point) => ({
          kind: "navsat",
          observed_at: point.captured_at,
          topic: ROS_TOPICS.navsat.topic,
          payload: {
            latitude: point.latitude,
            longitude: point.longitude,
            accuracy_m: point.accuracy_m,
          },
        })),
        ...visionPointsRef.current.map((point) => ({
          kind: "vision",
          observed_at: point.captured_at,
          topic: ROS_TOPICS.vision.topic,
          payload: {
            centroid_x: point.centroid_x,
            centroid_y: point.centroid_y,
            motion_ratio: point.motion_ratio,
            tracker: point.tracker,
            identity_inferred: point.identity_inferred,
          },
        })),
        ...(reviewedTranscript ? [{
          kind: "transcript",
          observed_at: stoppedAt,
          topic: ROS_TOPICS.transcript.topic,
          payload: { text: reviewedTranscript, reviewed_by_operator: true },
        }] : []),
        {
          kind: "runtime",
          observed_at: stoppedAt,
          topic: ROS_TOPICS.runtime.topic,
          payload: {
            schema: "campfire.phone-runtime.v1",
            job_id: jobField(job, "job_id"),
            run_id: currentRunIdRef.current,
            execution_mode: runExecutionMode,
            state: forcedStopCodeRef.current ? "ABORTED" : "STOPPED",
            duration_ms: Math.round(durationMs),
          },
        },
      ];
      const evidence: RuntimeEvidence = {
        schema: "campfire.runtime-evidence.v2",
        job_id: jobField(job, "job_id"),
        request_hash_sha256: requestHash,
        design_hash_sha256: jobField(job, "design_hash_sha256"),
        device_id: "smartphone-browser",
        started_at: startedAtRef.current,
        observed_at: stoppedAt,
        source: "SMARTPHONE_BROWSER",
        observations,
        summary: {
          runtime_version: PHONE_RUNTIME_VERSION,
          scenario,
          execution_mode: runExecutionMode,
          run_id: currentRunIdRef.current,
          duration_ms: Math.round(durationMs),
          estimated_steps: metricsRef.current.steps,
          route_distance_m: Number(metricsRef.current.distanceM.toFixed(2)),
          max_acceleration_m_s2: Number(metricsRef.current.maxAcceleration.toFixed(3)),
          imu_sample_count: imuPointsRef.current.length,
          route_point_count: routePointsRef.current.length,
          vision_sample_count: visionPointsRef.current.length,
          reviewed_transcript_characters: reviewedTranscript.length,
          unreviewed_transcript_characters_excluded: transcriptSnapshot.length - reviewedTranscript.length,
          raw_frames_stored: false,
          raw_audio_stored: false,
          raw_sensor_observations_uploaded_to_site: false,
          receipt_aggregate_metrics_uploaded_to_site: true,
          browser_speech_recognition_enabled: browserSpeechEnabled && thirdPartySpeechConsent,
          third_party_speech_processing_consented: thirdPartySpeechConsent,
          rosbridge_streamed: rosStreamedRef.current,
          rosbridge_dropped_messages: rosDroppedRef.current,
          simulation_endpoint_user_attested: runExecutionMode === "ROS2_SIMULATION" ? simulationAttestedForRunRef.current : null,
          observation_caps: { imu: MAX_IMU_POINTS, navsat: MAX_ROUTE_POINTS, vision: MAX_VISION_POINTS },
          user_agent: navigator.userAgent.slice(0, 300),
          secure_context: window.isSecureContext,
          physical_execution_verified: false,
          forced_stop_reason_code: forcedStopCodeRef.current,
        },
        physical_execution_verified_by_site: false,
      };
      const bundle = await createEvidenceArtifact(evidence);
      if (!mountedRef.current) return;
      setEvidenceBundle(bundle);
      setPhase("stopped");
      setNotice(forcedStopCodeRef.current
        ? `안전 중단(${forcedStopCodeRef.current})을 기록하고 로컬 증거를 만들었습니다. 성공 영수증은 선택할 수 없습니다.`
        : transcriptSnapshot && !reviewedTranscript
          ? "검토 확인되지 않은 전사는 증거에서 제외했습니다. 나머지 로컬 증거와 SHA-256을 만들었습니다."
          : "로컬 증거 파일과 SHA-256을 만들었습니다. 결과 상태는 사용자가 직접 선택해야 합니다.");
    } catch (cause) {
      if (!mountedRef.current) return;
      setError(cause instanceof Error ? cause.message : "증거 파일을 만들지 못했습니다.");
      setPhase("stopped");
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }

  async function makeReceipt(status: ReceiptStatus) {
    if (!job || !evidenceBundle) return;
    const receiptExecutionMode = frozenExecutionModeRef.current;
    if (!receiptExecutionMode) {
      setError("이 실행에 고정된 실행 방식이 없어 영수증을 만들 수 없습니다.");
      return;
    }
    if (forcedStopCodeRef.current && status === "SUCCEEDED") {
      setError("안전 중단된 실행은 성공으로 보고할 수 없습니다.");
      return;
    }
    setBusy("receipt");
    clearMessage();
    try {
      const value = await createRuntimeReceipt({
        job,
        deviceId: "smartphone-browser",
        status,
        observedAt: new Date().toISOString(),
        evidenceHashSha256: evidenceBundle.hashSha256,
        evidenceByteLength: evidenceBundle.byteLength,
        attemptId: currentRunIdRef.current,
        executionMode: receiptExecutionMode,
        reasonCode: forcedStopCodeRef.current ?? (status === "SUCCEEDED" ? "COMPLETED" : status === "FAILED" ? "RUNTIME_ERROR" : "USER_ABORTED"),
        terminalStep: forcedStopCodeRef.current ? "runtime_interrupted" : "evidence_finalized",
        metrics: {
          runtime_version: PHONE_RUNTIME_VERSION,
          duration_ms: Math.round(elapsedMs),
          estimated_steps: metricsRef.current.steps,
          route_distance_m: Number(metricsRef.current.distanceM.toFixed(2)),
          imu_samples: imuPointsRef.current.length,
          route_points: routePointsRef.current.length,
          vision_samples: visionPointsRef.current.length,
        },
      });
      if (!mountedRef.current) return;
      setReceipt(value);
      setPhase("receipt");
      setNotice("사용자 보고 영수증을 만들었습니다. 이 기록은 물리 실행을 증명하지 않습니다.");
    } catch (cause) {
      if (!mountedRef.current) return;
      setError(cause instanceof Error ? cause.message : "영수증을 만들지 못했습니다.");
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }

  async function submitReceipt() {
    if (!receipt || !designId) return;
    setBusy("submit");
    clearMessage();
    try {
      const response = await fetch("/api/designer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "apply_device_receipt", designId, receipt }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "영수증을 기록하지 못했습니다.");
      if (!mountedRef.current) return;
      setPhase("submitted");
      setNotice("작업 키와 해시가 일치하는 영수증을 워크벤치에 기록했습니다.");
    } catch (cause) {
      if (!mountedRef.current) return;
      setError(cause instanceof Error ? cause.message : "영수증을 기록하지 못했습니다.");
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }

  function publishTranscript() {
    if (phase !== "running") {
      setError("검토 전사는 센서 관찰 중에만 ROS로 보낼 수 있습니다.");
      return;
    }
    if (!transcript.trim()) {
      setError("보낼 검토 완료 전사를 입력하세요.");
      return;
    }
    if (!transcriptReviewedRef.current) {
      setError("자동·수동 전사 내용을 직접 검토했다고 확인한 뒤 보내세요.");
      return;
    }
    if (!rosDataConsent || rosState !== "connected") {
      setError("ROS 연결과 센서 요약 전송 동의가 필요합니다.");
      return;
    }
    sendRos(ROS_TOPICS.transcript, {
      data: JSON.stringify({
        schema: "campfire.reviewed-transcript.v1",
        captured_at: new Date().toISOString(),
        text: transcript.trim().slice(0, 12_000),
        reviewed_by_operator: true,
      }),
    });
    setNotice("검토 완료 전사를 사용자가 지정한 rosbridge로 보냈습니다.");
  }

  const guidance = !needsCamera || motionRatio < 0.01
    ? "움직임 대기"
    : visionCenter.x < -0.32
      ? "화면 왼쪽에 움직임"
      : visionCenter.x > 0.32
        ? "화면 오른쪽에 움직임"
        : "움직임이 화면 중앙";

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href={sessionId ? `/catalog?session=${encodeURIComponent(sessionId)}` : "/catalog"} className={styles.brand}>
          <span>CF</span>
          <div><strong>Campfire Phone Runtime</strong><small>스마트폰 센서 · ROS 2 시뮬레이션</small></div>
        </Link>
        <nav>
          <Link href="/catalog">설계기로 돌아가기</Link>
          <a href="https://github.com/Puro-33/campfire-foundry" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.runtimeMark}><i aria-hidden="true" /> {phaseLabels[phase]}</p>
          <h1>이 스마트폰이<br />센서 노드가 됩니다.</h1>
        </div>
        <p>카메라·모션·GPS·마이크를 사용자가 누른 동안만 읽습니다. 영상과 음성 원본은 저장하거나 사이트로 전송하지 않으며, 사람 추종은 사용자가 시뮬레이션 전용이라고 확인한 ROS 2 연결에서만 시작합니다.</p>
      </section>

      {(error || notice) && <div className={`${styles.message} ${error ? styles.messageError : styles.messageNotice}`} role={error ? "alert" : "status"}>
        <span>{error || notice}</span><button type="button" onClick={clearMessage} aria-label="메시지 닫기">×</button>
      </div>}

      <section className={styles.runtimeShell}>
        <div className={styles.instrumentColumn}>
          <section className={styles.scope} aria-label="실시간 스마트폰 센서 계기판">
            <div className={styles.scopeHead}>
              <div><span>실행 상태</span><strong>{scenario ? scenarioLabels[scenario] : "작업을 불러오세요"}</strong></div>
              <div className={styles.phaseLamp}><i className={phase === "running" ? styles.liveLamp : ""} />{phaseLabels[phase]}</div>
            </div>

            <div className={styles.viewport}>
              {needsCamera ? <>
                <video ref={videoRef} className={phase === "running" ? styles.videoLive : styles.videoHidden} muted playsInline aria-label="기기 카메라 미리보기" />
                <canvas ref={overlayRef} aria-hidden="true" />
              </> : <div className={styles.reticle} aria-hidden="true">
                <i className={styles.axisX} /><i className={styles.axisY} /><span /><b />
              </div>}
              <div className={styles.viewportLabel}>
                <span>{needsCamera ? "프레임 차이 기반 움직임 중심" : scenario === "gait_route" ? "관성·위치 시간축" : "동의 기반 음성 세션"}</span>
                <strong>{phase === "running" ? guidance : "원본 미저장"}</strong>
              </div>
              {needsCamera && <div className={styles.identityWarning}>사람 신원 식별 안 함</div>}
            </div>

            <div className={styles.telemetry}>
              <div><span>경과</span><strong>{formatElapsed(elapsedMs)}</strong><small>분:초</small></div>
              <div><span>걸음 추정</span><strong>{steps}</strong><small>기기 흔들림 기반</small></div>
              <div><span>경로</span><strong>{distanceM.toFixed(1)}</strong><small>미터</small></div>
              <div><span>움직임</span><strong>{Math.round(motionRatio * 100)}</strong><small>변화 픽셀 %</small></div>
            </div>

            <div className={styles.sensorRail}>
              {(["camera", "microphone", "motion", "location"] as const).map((sensor) => <span key={sensor} className={sensorState[sensor] ? styles.sensorOn : ""}>
                <i /><b>{sensor === "camera" ? "카메라" : sensor === "microphone" ? "마이크" : sensor === "motion" ? "모션" : "GPS"}</b><small>{sensorState[sensor] ? "사용 중" : "꺼짐"}</small>
              </span>)}
              <span className={rosState === "connected" ? styles.sensorOn : ""}><i /><b>ROS</b><small>{rosState === "connected" ? "연결됨" : "꺼짐"}</small></span>
              {gpsAccuracy !== null && <em>GPS ±{Math.round(gpsAccuracy)}m</em>}
            </div>
          </section>

          <section className={styles.runControls}>
            <div>
              <span>실행 방식</span>
              <strong>{executionMode === "ROS2_SIMULATION" ? "ROS 2 시뮬레이션 전용" : "스마트폰 폐루프"}</strong>
              <p>{executionMode === "ROS2_SIMULATION" ? "런타임은 Campfire 센서 토픽만 발행합니다. 연결 뒤쪽에 물리 제어기가 없는지는 사용자가 확인하며, 제공 ROS 패키지는 시뮬레이터 토픽만 허용합니다." : "스마트폰 화면·진동과 로컬 관찰 파일이 출력입니다."}</p>
            </div>
            <div className={styles.runButtons}>
              {phase !== "running"
                ? <button type="button" className={styles.startButton} onClick={() => void startRun()} disabled={!canStart || Boolean(busy)}>{busy === "start" ? "권한 확인 중…" : "센서 관찰 시작"}</button>
                : <button type="button" className={styles.stopButton} onClick={() => void stopRun()} disabled={Boolean(busy)}>{busy === "stop" ? "증거 생성 중…" : "중단하고 증거 만들기"}</button>}
            </div>
          </section>

          {needsMicrophone && <section className={styles.transcriptPanel}>
            <div className={styles.sectionTitle}><div><span>검토한 전사</span><h2 id="reviewed-transcript-heading">기억으로 남길 문장만 적으세요.</h2></div><b>음성 원본 저장 안 함</b></div>
            <p className={styles.transcriptNote}>실행 중 마이크 스트림은 열리지만 오디오 버퍼나 파일은 만들지 않습니다. 브라우저 음성 인식을 켠 경우에는 위에서 동의한 외부 처리가 적용될 수 있습니다.</p>
            <textarea id="reviewed-transcript" aria-labelledby="reviewed-transcript-heading" value={transcript} disabled={Boolean(evidenceBundle)} onChange={(event) => {
              const next = event.target.value.slice(0, 12_000);
              transcriptRef.current = next;
              transcriptReviewedRef.current = false;
              setTranscriptReviewed(false);
              setTranscript(next);
            }} placeholder="직접 입력하거나, 별도 동의 후 브라우저 음성 인식 초안을 받아 수정하세요." rows={7} />
            <label className={styles.reviewRow}><input type="checkbox" checked={transcriptReviewed} disabled={!transcript.trim() || Boolean(evidenceBundle)} onChange={(event) => {
              transcriptReviewedRef.current = event.target.checked;
              setTranscriptReviewed(event.target.checked);
            }} /><span>현재 전사 내용을 직접 읽고 확인했습니다.</span></label>
            <div className={styles.inlineActions}><small>{transcript.length.toLocaleString()} / 12,000자</small><button type="button" onClick={publishTranscript} disabled={phase !== "running" || !transcriptReviewed}>검토 완료 전사를 ROS로 보내기</button></div>
          </section>}

          {evidenceBundle && <section className={styles.evidencePanel}>
            <div className={styles.sectionTitle}><div><span>로컬 증거</span><h2>실행 요약에 실제 SHA-256을 붙였습니다.</h2></div><b>{evidenceBundle.byteLength.toLocaleString()} bytes</b></div>
            <code>{evidenceBundle.hashSha256}</code>
            <button type="button" onClick={() => downloadBlob(evidenceBundle.blob, evidenceBundle.fileName)}>증거 JSON 다운로드</button>
            {phase === "stopped" && <div className={styles.outcomeChoice}>
              <p>{forcedStopCode ? `안전 중단 사유 ${forcedStopCode}가 기록되었습니다. 실패 또는 중단으로만 보고할 수 있습니다.` : "결과는 자동 판정하지 않습니다. 관찰한 결과를 직접 고르세요."}</p>
              <button type="button" onClick={() => void makeReceipt("SUCCEEDED")} disabled={Boolean(busy) || Boolean(forcedStopCode)}>성공으로 보고</button>
              <button type="button" onClick={() => void makeReceipt("FAILED")} disabled={Boolean(busy)}>실패로 보고</button>
              <button type="button" onClick={() => void makeReceipt("ABORTED")} disabled={Boolean(busy)}>중단으로 보고</button>
            </div>}
          </section>}

          {receipt && <section className={styles.receiptPanel}>
            <div className={styles.sectionTitle}><div><span>사용자 보고 영수증</span><h2>{phase === "submitted" ? "워크벤치에 기록했습니다." : "작업 키를 확인한 뒤 기록하세요."}</h2></div><b>물리 실행 검증 아님</b></div>
            <pre>{JSON.stringify(receipt, null, 2)}</pre>
            <div className={styles.receiptActions}>
              <button type="button" onClick={() => downloadBlob(jsonBlob(receipt), `campfire-receipt-${jobField(job, "job_id") || "runtime"}.json`)}>영수증 다운로드</button>
              <button type="button" className={styles.submitButton} onClick={() => void submitReceipt()} disabled={phase === "submitted" || Boolean(busy)}>{phase === "submitted" ? "기록 완료" : busy === "submit" ? "검증 중…" : "워크벤치에 영수증 기록"}</button>
            </div>
          </section>}
        </div>

        <aside className={styles.controlColumn}>
          <section className={styles.controlSection}>
            <div className={styles.controlHeading}><span>작업 계약</span><b>{sourceLabel}</b></div>
            <dl className={styles.contractList}>
              <div><dt>시나리오</dt><dd>{scenario ? scenarioLabels[scenario] : "—"}</dd></div>
              <div><dt>계약 스키마</dt><dd>{job?.schema ?? "—"}</dd></div>
              <div><dt>작업 ID</dt><dd>{jobField(job, "job_id") || "—"}</dd></div>
              <div><dt>요청 해시</dt><dd title={requestHash}>{shortHash(requestHash)}</dd></div>
              <div><dt>목표</dt><dd>{goal || "설계기에서 작업을 만드세요."}</dd></div>
            </dl>
            <label className={`${styles.fileButton} ${configurationLocked ? styles.fileButtonDisabled : ""}`}>작업 JSON 다시 확인<input type="file" accept="application/json,.json" disabled={configurationLocked} onChange={(event) => void importJob(event)} /></label>
            <small>최대 256KB. 가져온 파일은 이 계정의 서버 저장본과 완전히 일치해야 실행됩니다.</small>
          </section>

          <section className={styles.controlSection}>
            <div className={styles.controlHeading}><span>사람 확인</span><b>시작 전 필수</b></div>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={sensorConsent} onChange={(event) => { sensorConsentRef.current = event.target.checked; setSensorConsent(event.target.checked); }} disabled={configurationLocked} />
              <span>
                <strong>{needsMicrophone ? "모든 대화 참여자의 수집 동의를 받았습니다." : needsCamera ? "카메라 범위의 사람에게 관찰 사실을 알렸습니다." : "위치·모션 수집 범위에 동의합니다."}</strong>
                <small>화면에 표시된 시나리오의 센서만 세션 동안 읽습니다.</small>
              </span>
            </label>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={safetyConsent} onChange={(event) => { safetyConsentRef.current = event.target.checked; setSafetyConsent(event.target.checked); }} disabled={configurationLocked} />
              <span><strong>중단 조건과 실행 한계를 확인했습니다.</strong><small>사이트는 물리 실행을 허가하거나 검증하지 않습니다.</small></span>
            </label>
            {needsCamera && <label className={styles.checkRow}>
              <input type="checkbox" checked={localHaptics} onChange={(event) => setLocalHaptics(event.target.checked)} />
              <span><strong>화면 가장자리 움직임에 짧게 진동</strong><small>기기 안에서만 작동하며 언제든 끌 수 있습니다.</small></span>
            </label>}
            {needsMicrophone && <>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={thirdPartySpeechConsent} onChange={(event) => { setThirdPartySpeechConsent(event.target.checked); if (!event.target.checked) setBrowserSpeechEnabled(false); }} disabled={configurationLocked} />
                <span><strong>브라우저 음성 인식의 외부 처리 가능성을 이해합니다.</strong><small>브라우저 구현에 따라 음성이 서비스 제공자에게 전송될 수 있습니다.</small></span>
              </label>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={browserSpeechEnabled} onChange={(event) => setBrowserSpeechEnabled(event.target.checked)} disabled={!thirdPartySpeechConsent || configurationLocked} />
                <span><strong>음성 인식 초안 사용</strong><small>선택하지 않으면 마이크 상태 확인과 수동 전사만 사용합니다.</small></span>
              </label>
            </>}
          </section>

          <section className={styles.controlSection}>
            <div className={styles.controlHeading}><span>ROS 2 연결</span><b className={rosState === "connected" ? styles.connectedText : ""}>{rosState === "connected" ? "연결됨" : "선택 사항"}</b></div>
            <label className={styles.fieldLabel}>rosbridge WebSocket 주소<input value={rosUrl} onChange={(event) => {
              setRosUrl(event.target.value);
              rosSimulationAttestedRef.current = false;
              setRosSimulationAttested(false);
            }} placeholder="wss://robot.example:9090" disabled={rosState === "connecting" || rosState === "connected" || configurationLocked} /></label>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={rosDataConsent} onChange={(event) => { rosDataConsentRef.current = event.target.checked; setRosDataConsent(event.target.checked); }} disabled={rosState === "connected" || configurationLocked} />
              <span><strong>IMU·위치·움직임·검토 전사를 이 주소로 전송</strong><small>사이트 서버가 아니라 사용자가 지정한 rosbridge로 직접 전송합니다.</small></span>
            </label>
            {executionMode === "ROS2_SIMULATION" && <label className={styles.checkRow}>
              <input type="checkbox" checked={frozenExecutionMode === "ROS2_SIMULATION" || rosSimulationAttested} onChange={(event) => { rosSimulationAttestedRef.current = event.target.checked; setRosSimulationAttested(event.target.checked); }} disabled={frozenExecutionMode !== null || rosState !== "connected" || configurationLocked} />
              <span><strong>이 rosbridge가 시뮬레이터에만 연결됨을 확인했습니다.</strong><small>모든 ROS 2 시뮬레이션 실행에 필요합니다. 런타임은 bridge 뒤의 재발행·물리 제어 연결을 기술적으로 확인할 수 없습니다.</small></span>
            </label>}
            <div className={styles.rosButtons}>
              {rosState === "connected"
                ? <button type="button" onClick={() => disconnectRos()} disabled={phase === "running"}>연결 끊기</button>
                : rosState === "connecting"
                  ? <button type="button" onClick={() => disconnectRos("연결 시도를 취소했습니다.")}>연결 취소</button>
                  : <button type="button" onClick={connectRos}>rosbridge 연결</button>}
              <span>{rosMessage}</span>
            </div>
            <details className={styles.feedbackDetails}>
              <summary>허용할 시뮬레이터 피드백</summary>
              <label><input type="checkbox" checked={rosVibrationFeedback} onChange={(event) => setRosVibrationFeedback(event.target.checked)} /> 짧은 진동 / 진동 중지</label>
              <label><input type="checkbox" checked={rosSpeechFeedback} onChange={(event) => setRosSpeechFeedback(event.target.checked)} /> 80자 이하 기기 음성</label>
              <small>현재 작업 ID가 앞에 붙은 VIBRATE_SHORT, VIBRATE_STOP, 제한된 SPEAK만 실행 중에 받습니다. 이동·모터 명령은 받지 않습니다.</small>
            </details>
            <details className={styles.topicDetails}>
              <summary>ROS 토픽 계약 보기</summary>
              {Object.values(ROS_TOPICS).map((topic) => <code key={topic.topic}>{topic.topic}</code>)}
            </details>
            <a className={styles.packageLink} href="https://github.com/Puro-33/campfire-foundry/tree/main/ros2/campfire_phone_bridge" target="_blank" rel="noreferrer">ROS 2 Jazzy 시뮬레이터 패키지 열기</a>
          </section>

          <section className={styles.boundaryNote}>
            <strong>이 런타임이 하지 않는 것</strong>
            <p>사람 신원 식별, 원본 영상·음성 업로드, raw serial·관절 명령, 실제 로봇 실행 확인을 하지 않습니다.</p>
            <small>Runtime {PHONE_RUNTIME_VERSION} · {secureContext ? "보안 컨텍스트" : "비보안 컨텍스트"}</small>
          </section>
        </aside>
      </section>
    </main>
  );
}
