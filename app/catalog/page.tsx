"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { PhysicalAiPlan, PlanValidation, RuntimeCapabilities, ValidationInput } from "@/lib/physical-ai-planner";
import styles from "./catalog.module.css";

type HistoryItem = {
  sessionId: string;
  designId: string;
  title: string;
  goal: string;
  state: string;
  updatedAt: string;
};

type ValidationRecord = PlanValidation & {
  schema: string;
  id: string;
  design_id: string;
  input_hash_sha256: string;
  input_snapshot?: ValidationInput;
  created_at: string;
};

type DeviceJob = {
  id: string;
  status: string;
  intent: string;
  idempotencyKey: string;
  request: Record<string, unknown> | null;
  receipt: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type DesignerResponse = {
  history: HistoryItem[];
  active: null | {
    sessionId: string;
    state: string;
    plan: PhysicalAiPlan;
    validation: ValidationRecord | null;
    job: DeviceJob | null;
    receipt: Record<string, unknown> | null;
  };
  error?: string;
};

const templates = [
  {
    title: "스마트폰 비전 안내",
    goal: "스마트폰 카메라로 주변 움직임을 로컬에서 감지하고 화면과 진동으로 방향을 안내하기",
    deviceProfile: "smartphone",
    successMetric: "30초 동안 움직임 관찰 20개 이상을 만들고 원시 프레임을 저장하거나 서버에 업로드하지 않기",
  },
  {
    title: "OpenCat 사람 추종",
    goal: "OpenCat이 스마트폰 카메라로 한 사람을 식별하고 안전 거리를 유지하며 따라오게 만들기",
    deviceProfile: "opencat_phone",
    successMetric: "5m 경로에서 목표 거리 2m ± 0.5m를 80% 이상 유지하고 대상 상실 시 즉시 정지",
  },
  {
    title: "모닥불 대화 기억",
    goal: "모닥불 주변의 대화를 참여자 동의 아래 기록하고 발화와 상황을 출처가 있는 기억으로 정리하기",
    deviceProfile: "smartphone",
    successMetric: "동의된 발화만 저장하고 전사 검토에서 핵심 내용 누락률 10% 이하",
  },
  {
    title: "스마트폰 보행 경로",
    goal: "스마트폰의 흔들림과 위치를 시간순으로 결합해 걸음걸이와 이동 경로를 관찰하기",
    deviceProfile: "smartphone",
    successMetric: "10분 보행에서 위치 누락 구간 5% 이하이며 센서와 위치 시각 오차 1초 이하",
  },
] as const;

const constraintOptions = [
  ["privacy_first", "민감 데이터 최소화 우선"],
  ["offline_preferred", "로컬 처리 우선"],
  ["low_budget", "저비용 구현 우선"],
  ["human_approval", "사람 승인 절차 우선"],
] as const;

const statusLabels: Record<string, string> = {
  DRAFT: "설계 초안",
  BLOCKED: "확인 항목 남음",
  READY: "기존 확인 기록",
  MANIFEST_READY: "작업 JSON 생성 가능",
  JOB_MANIFEST_CREATED: "JSON 생성·영수증 대기",
  RECEIPT_RECORDED: "영수증 JSON 기록됨",
  FAILURE_REPORTED: "실패·중단 영수증 기록됨",
  EXECUTION_ABORTED: "사용자 중단 영수증 기록됨",
  LOCAL_CHANGES: "변경 후 다시 확인 필요",
  COMPLETED: "기존 완료 기록",
  DEVICE_FAILED: "기존 실패 기록",
  WORKBENCH_READY: "작업대 제공",
  DEVICE_DECLARED: "장치 구성에 포함",
  CATALOG_CANDIDATE: "온톨로지 후보",
  MISSING: "연결 필요",
};

const runtimeLabels: Array<[keyof RuntimeCapabilities, string]> = [
  ["cameraApi", "카메라"],
  ["microphoneApi", "마이크"],
  ["motionApi", "모션 센서"],
  ["geolocationApi", "위치"],
  ["clockApi", "단조 시계"],
  ["serialApi", "직렬 장치"],
];

const executorLabels: Record<string, string> = {
  browser_sensor_adapter: "브라우저 센서 어댑터",
  external_model_adapter: "외부 모델 어댑터",
  external_device_adapter: "외부 장치 어댑터",
  workbench: "Campfire 작업대",
};

const emptyRuntime: RuntimeCapabilities = {
  cameraApi: false,
  microphoneApi: false,
  motionApi: false,
  geolocationApi: false,
  clockApi: false,
  serialApi: false,
};

function displayDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function shortHash(value: string) {
  return value ? `${value.slice(0, 9)}…${value.slice(-5)}` : "—";
}

function safeExternalUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function PhysicalAiDesignerPage() {
  const [data, setData] = useState<DesignerResponse | null>(null);
  const [goal, setGoal] = useState<string>(templates[0].goal);
  const [deviceProfile, setDeviceProfile] = useState<string>(templates[0].deviceProfile);
  const [successMetric, setSuccessMetric] = useState<string>(templates[0].successMetric);
  const [constraints, setConstraints] = useState<string[]>(["human_approval"]);
  const [selectedResources, setSelectedResources] = useState<Record<string, string>>({});
  const [runtime, setRuntime] = useState<RuntimeCapabilities>(emptyRuntime);
  const [deviceConfirmed, setDeviceConfirmed] = useState(false);
  const [softwareReady, setSoftwareReady] = useState(false);
  const [externalReady, setExternalReady] = useState(false);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [receiptText, setReceiptText] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [validationDirty, setValidationDirty] = useState(false);
  const designRequestRef = useRef<string | null>(null);
  const validationRequestRef = useRef<string | null>(null);

  function initializePlan(response: DesignerResponse) {
    const nextPlan = response.active?.plan;
    if (!nextPlan) return;
    const snapshot = response.active?.validation?.input_snapshot;
    const validated = Object.fromEntries(
      (response.active?.validation?.selectedResources ?? [])
        .filter((candidate) => typeof candidate.capabilityId === "string")
        .map((candidate) => [candidate.capabilityId, candidate.catalogNodeId]),
    );
    setSelectedResources(snapshot?.selectedResources ?? validated);
    setRuntime(snapshot?.runtime ?? emptyRuntime);
    setDeviceConfirmed(snapshot?.deviceConfirmed ?? false);
    setSoftwareReady(snapshot?.softwareReady ?? false);
    setExternalReady(snapshot?.externalReady ?? false);
    setConsentConfirmed(snapshot?.consentConfirmed ?? false);
    setSafetyConfirmed(snapshot?.safetyConfirmed ?? false);
    setValidationDirty(false);
    validationRequestRef.current = null;
    setReceiptText("");
  }

  async function load(sessionId?: string) {
    setBusy("load");
    try {
      const params = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
      const response = await fetch(`/api/designer${params}`, { cache: "no-store" });
      const payload = await response.json() as DesignerResponse;
      if (!response.ok) throw new Error(payload.error ?? "설계 기록을 불러오지 못했습니다.");
      setData(payload);
      initializePlan(payload);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "설계 기록을 불러오지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/designer", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as DesignerResponse;
        if (!response.ok) throw new Error(payload.error ?? "설계 기록을 불러오지 못했습니다.");
        return payload;
      })
      .then((payload) => {
        setData(payload);
        initializePlan(payload);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "설계 기록을 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, []);

  const active = data?.active;
  const plan = active?.plan;
  const validation = active?.validation;
  const job = active?.job;

  function markValidationDirty() {
    setValidationDirty(true);
    validationRequestRef.current = null;
  }

  function markDesignInputDirty() {
    designRequestRef.current = null;
  }

  async function post(payload: Record<string, unknown>, actionName: string, successMessage: string) {
    setBusy(actionName);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/designer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as DesignerResponse;
      if (!response.ok) throw new Error(result.error ?? "요청을 처리하지 못했습니다.");
      setData(result);
      if (actionName === "create") initializePlan(result);
      if (actionName === "validate") setValidationDirty(false);
      setNotice(successMessage);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function submitDesign(event: FormEvent) {
    event.preventDefault();
    designRequestRef.current ??= crypto.randomUUID();
    const result = await post({
      action: "create_design",
      requestId: designRequestRef.current,
      goal,
      deviceProfile,
      successMetric,
      constraints,
    }, "create", "목표를 능력·근거·실행 단계로 변환해 저장했습니다.");
    if (result?.active) {
      designRequestRef.current = null;
      document.getElementById("blueprint")?.scrollIntoView({ behavior: "smooth" });
    }
  }

  function applyTemplate(template: typeof templates[number]) {
    markDesignInputDirty();
    setGoal(template.goal);
    setDeviceProfile(template.deviceProfile);
    setSuccessMetric(template.successMetric);
  }

  function selectCandidate(capabilityId: string, resourceId: string) {
    if (!plan) return;
    setSelectedResources((current) => ({ ...current, [capabilityId]: resourceId }));
    markValidationDirty();
  }

  async function probeCurrentDevice() {
    if (!plan) return;
    setBusy("probe");
    setError("");
    setNotice("");
    markValidationDirty();
    const next = { ...emptyRuntime };
    const issues: string[] = [];
    const required = new Set(plan.capabilities.map((capability) => capability.id));
    try {
      const needsCamera = required.has("camera_sensor");
      const needsMicrophone = required.has("microphone_sensor");
      if (needsCamera || needsMicrophone) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: needsCamera, audio: needsMicrophone });
          next.cameraApi = !needsCamera || stream.getVideoTracks().length > 0;
          next.microphoneApi = !needsMicrophone || stream.getAudioTracks().length > 0;
          stream.getTracks().forEach((track) => track.stop());
        } catch {
          issues.push(needsCamera && needsMicrophone ? "카메라·마이크 권한" : needsCamera ? "카메라 권한" : "마이크 권한");
        }
      }
      if (required.has("location_sensor")) {
        try {
          await new Promise<void>((resolve, reject) => navigator.geolocation.getCurrentPosition(
            () => resolve(),
            (reason) => reject(reason),
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
          ));
          next.geolocationApi = true;
        } catch {
          issues.push("위치 권한");
        }
      }
      if (required.has("motion_sensor")) {
        const motion = (window as typeof window & {
          DeviceMotionEvent?: { requestPermission?: () => Promise<string> };
        }).DeviceMotionEvent;
        if (!motion) {
          issues.push("모션 센서 미지원");
        } else {
          try {
            const permission = motion.requestPermission ? await motion.requestPermission() : "granted";
            next.motionApi = permission === "granted";
            if (!next.motionApi) issues.push("모션 센서 권한");
          } catch {
            issues.push("모션 센서 권한");
          }
        }
      }
      if (required.has("clock_sync")) {
        next.clockApi = typeof performance !== "undefined" && Number.isFinite(performance.timeOrigin);
        if (!next.clockApi) issues.push("단조 시계");
      }
      if (required.has("robot_transport")) {
        type SerialApi = { getPorts(): Promise<unknown[]>; requestPort(): Promise<unknown> };
        const serial = (navigator as Navigator & { serial?: SerialApi }).serial;
        if (!serial) {
          issues.push("Web Serial 미지원");
        } else {
          try {
            const ports = await serial.getPorts();
            if (ports.length === 0) await serial.requestPort();
            next.serialApi = true;
          } catch {
            issues.push("OpenCat 포트 선택");
          }
        }
      }
      setRuntime(next);
      setNotice(issues.length ? `확인되지 않은 항목: ${issues.join(", ")}` : "필요한 장치 접근을 현재 기기에서 확인했습니다. 센서 내용은 업로드하지 않았습니다.");
    } catch {
      setError("브라우저 장치 접근을 확인하는 중 오류가 발생했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function runValidation() {
    if (!plan) return;
    validationRequestRef.current ??= crypto.randomUUID();
    const result = await post({
      action: "validate_design",
      requestId: validationRequestRef.current,
      designId: plan.id,
      selectedResources,
      runtime,
      deviceConfirmed,
      softwareReady,
      externalReady,
      consentConfirmed,
      safetyConfirmed,
    }, "validate", "자동 검사와 사용자가 확인한 항목을 구분해 저장했습니다.");
    if (result) validationRequestRef.current = null;
  }

  async function issueJob() {
    if (!plan) return;
    await post({ action: "issue_device_job", designId: plan.id }, "job", "고수준 작업 JSON을 만들었습니다. 아직 장치로 전송되지는 않았습니다.");
  }

  async function applyReceipt(event: FormEvent) {
    event.preventDefault();
    if (!plan) return;
    try {
      const receipt = JSON.parse(receiptText) as unknown;
      await post({ action: "apply_device_receipt", designId: plan.id, receipt }, "receipt", "작업 키가 일치하는 장치 영수증을 저장했습니다.");
    } catch {
      setError("영수증이 올바른 JSON인지 확인하세요.");
    }
  }

  const progress = validation?.checkCoverage ?? plan?.initialCoverage ?? 0;
  const progressLabel = validation ? validationDirty ? "저장된 확인 기록률 · 변경됨" : "확인 항목 기록률" : "명세 구성률";
  const catalogCapabilities = plan?.capabilities.filter((capability) => capability.kind === "catalog") ?? [];
  const externalCapabilities = plan?.capabilities.filter((capability) => capability.kind === "external") ?? [];
  const needsExternal = externalCapabilities.length > 0;
  const needsConsent = plan?.capabilities.some((capability) => capability.id === "privacy_gate");
  const needsSafety = plan?.capabilities.some((capability) => capability.id === "safety_receipt");
  const needsRobot = plan?.capabilities.some((capability) => capability.id === "robot_transport");
  const state = active?.state ?? "DRAFT";
  const displayState = validationDirty && state === "MANIFEST_READY" ? "LOCAL_CHANGES" : state;
  const stateTone = displayState === "MANIFEST_READY" || displayState === "RECEIPT_RECORDED" ? styles.good : displayState === "BLOCKED" || displayState === "FAILURE_REPORTED" || displayState === "EXECUTION_ABORTED" || displayState === "LOCAL_CHANGES" ? styles.bad : styles.waiting;
  const validationCurrent = Boolean(validation && !validationDirty);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <span>CF</span>
          <div><strong>Campfire Foundry</strong><small>Physical AI workbench</small></div>
        </Link>
        <nav><a href="#designer">설계</a><Link href="/runtime">스마트폰 ROS</Link><a href="#blueprint">명세 구조</a><a href="/api/catalog/export">온톨로지 원본</a></nav>
      </header>

      <section className={styles.mission} id="designer">
        <div className={styles.intro}>
          <p>목표에서 실행 사양까지</p>
          <h1>근거를 검토할 수 있는<br />Physical AI 명세로 바꾸세요.</h1>
          <span>현재 지원하는 세 가지 과업에서 센서·정책·데이터·중단 조건을 연결하고 JSON으로 내보냅니다. 카탈로그 수록과 사용자 확인은 실제 기능 검증과 구분해 기록합니다.</span>
          {data?.history.length ? <div className={styles.history}>
            <strong>저장된 설계</strong>
            {data.history.slice(0, 4).map((item) => <button type="button" key={item.designId} onClick={() => void load(item.sessionId)} className={item.designId === plan?.id ? styles.activeHistory : ""}>
              <span>{item.title}</span><small>{statusLabels[item.state] ?? item.state} · {displayDate(item.updatedAt)}</small>
            </button>)}
          </div> : null}
        </div>

        <form className={styles.composer} onSubmit={submitDesign}>
          <label className={styles.goalField}>
            <span>무엇을 만들고 싶나요?</span>
            <textarea value={goal} onChange={(event) => { markDesignInputDirty(); setGoal(event.target.value); }} maxLength={600} required />
          </label>
          <div className={styles.templates}>
            {templates.map((template) => <button type="button" key={template.title} onClick={() => applyTemplate(template)}>{template.title}</button>)}
          </div>
          <div className={styles.fieldRow}>
            <label><span>사용할 장치</span><select value={deviceProfile} onChange={(event) => { markDesignInputDirty(); setDeviceProfile(event.target.value); }}><option value="opencat_phone">OpenCat + 스마트폰</option><option value="smartphone">스마트폰</option><option value="opencat">OpenCat</option><option value="simulator">시뮬레이터만</option><option value="custom">직접 구성</option></select></label>
            <label><span>성공 조건</span><input value={successMetric} onChange={(event) => { markDesignInputDirty(); setSuccessMetric(event.target.value); }} maxLength={240} required /></label>
          </div>
          <fieldset className={styles.constraints}><legend>우선순위 태그 · 현재는 명세 메타데이터로 저장</legend>{constraintOptions.map(([value, label]) => <label key={value}><input type="checkbox" checked={constraints.includes(value)} onChange={(event) => { markDesignInputDirty(); setConstraints((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value)); }} /><span>{label}</span></label>)}</fieldset>
          <button className={styles.primaryAction} disabled={Boolean(busy)}>{busy === "create" ? "설계 중…" : "설계안 만들기"}</button>
        </form>
      </section>

      {(error || notice) && <div className={`${styles.message} ${error ? styles.errorMessage : styles.noticeMessage}`} role={error ? "alert" : "status"}><strong>{error ? "확인 필요" : "완료"}</strong><span>{error || notice}</span><button onClick={() => { setError(""); setNotice(""); }} aria-label="메시지 닫기">×</button></div>}

      <section className={styles.blueprint} id="blueprint">
        <div className={styles.blueprintHeader}>
          <div><span className={`${styles.stateBadge} ${stateTone}`}>{statusLabels[displayState] ?? displayState}</span><h2>{plan?.scenario.title ?? "목표를 입력하면 실행 구조가 여기에 생깁니다."}</h2>{plan && <p>{plan.scenario.reason} · 설계 해시 {shortHash(plan.designHash)}</p>}</div>
          <div className={styles.readiness}><strong>{progress}%</strong><span>{progressLabel}</span></div>
        </div>

        <div className={styles.pipeline}>
          {(plan?.stages ?? [
            { id: "sense", label: "감지", description: "센서 정의 대기", capabilityIds: [] },
            { id: "interpret", label: "해석", description: "모델 정의 대기", capabilityIds: [] },
            { id: "decide", label: "결정", description: "정책 정의 대기", capabilityIds: [] },
            { id: "act", label: "행동", description: "장치 정의 대기", capabilityIds: [] },
            { id: "verify", label: "검증", description: "성공 조건 정의 대기", capabilityIds: [] },
          ]).map((stage) => <article key={stage.id}><span>{stage.label}</span><p>{stage.description}</p><i>{stage.capabilityIds.length ? `${stage.capabilityIds.length}개 능력` : "정의 대기"}</i></article>)}
        </div>

        {!plan ? <div className={styles.emptyState}><strong>노드를 보는 데서 끝내지 않습니다.</strong><p>목표를 입력하면 출처가 있는 참고 자료, 센서 입력, 단계별 작업과 중단 조건을 하나의 명세로 만들고 외부 어댑터용 JSON으로 내보냅니다.</p></div> : <>
          <div className={styles.workbench}>
            <section className={styles.capabilityPanel}>
              <header><span>필요 능력</span><strong>{plan.capabilities.length}</strong></header>
              {plan.capabilities.map((capability) => <article key={capability.id}>
                <div><strong>{capability.label}</strong><span className={styles[capability.status === "MISSING" ? "bad" : capability.status === "WORKBENCH_READY" ? "good" : "waiting"]}>{statusLabels[capability.status]}</span></div>
                <p>{capability.why}</p>
              </article>)}
            </section>

            <section className={styles.evidencePanel}>
              <header><span>명세에 연결할 참고 자료</span><small>출처 상태일 뿐 기능 검증이 아닙니다.</small></header>
              {catalogCapabilities.map((capability) => <fieldset key={capability.id}>
                <legend>{capability.label}</legend>
                {capability.candidates.length ? capability.candidates.map((candidate) => {
                  const evidenceUrl = safeExternalUrl(candidate.evidenceUrl);
                  const resourceUrl = safeExternalUrl(candidate.resourceUrl);
                  return <div className={styles.candidate} key={candidate.catalogNodeId}>
                    <label>
                      <input type="radio" name={capability.id} checked={selectedResources[capability.id] === candidate.catalogNodeId} onChange={() => selectCandidate(capability.id, candidate.catalogNodeId)} disabled={Boolean(job)} />
                      <div><strong>{candidate.name}</strong><span>{candidate.nodeType} · 출처 상태 {candidate.verificationStatus}</span><p>{candidate.description}</p></div>
                    </label>
                    {(evidenceUrl || resourceUrl) && <nav>{evidenceUrl && <a href={evidenceUrl} target="_blank" rel="noreferrer">근거 원문</a>}{resourceUrl && <a href={resourceUrl} target="_blank" rel="noreferrer">리소스</a>}</nav>}
                  </div>;
                }) : <p className={styles.noCandidate}>현재 온톨로지에 출처가 확인된 참고 후보가 없습니다.</p>}
              </fieldset>)}
              {needsExternal && <div className={styles.externalGap}><strong>온톨로지 밖 외부 연결</strong><p>{externalCapabilities.map((capability) => capability.label).join(" · ")}은 현재 카탈로그의 기능 근거가 없어 사용자 확인이 필요한 외부 어댑터로 명시했습니다.</p></div>}
            </section>

            <aside className={styles.gatePanel}>
              <header><span>JSON 생성 전 확인</span><strong>{validationCurrent && validation?.status === "ATTESTED" ? "확인 기록 완료" : validationDirty ? "변경 후 다시 확인" : "확인 필요"}</strong></header>
              <button type="button" className={styles.probeButton} onClick={() => void probeCurrentDevice()} disabled={Boolean(busy) || Boolean(job)}>{busy === "probe" ? "접근 확인 중…" : "브라우저 권한·포트 접근 확인"}</button>
              <p className={styles.privacyNote}>권한은 점검에만 사용하며 카메라·음성·위치 내용은 서버에 보내지 않습니다.</p>
              <div className={styles.runtimeGrid}>{runtimeLabels.map(([key, label]) => <span key={key} className={runtime[key] ? styles.runtimeOn : ""} aria-label={`${label}: ${runtime[key] ? "확인됨" : "미확인"}`}><i />{label} · {runtime[key] ? "확인됨" : "미확인"}</span>)}</div>
              <div className={styles.assertions}>
                {needsRobot && <label><input type="checkbox" checked={deviceConfirmed} onChange={(event) => { setDeviceConfirmed(event.target.checked); markValidationDirty(); }} disabled={Boolean(job)} /><span>사용자 확인: 선택한 포트가 OpenCat 어댑터이며 연결 준비가 됐습니다.</span></label>}
                {catalogCapabilities.length > 0 && <label><input type="checkbox" checked={softwareReady} onChange={(event) => { setSoftwareReady(event.target.checked); markValidationDirty(); }} disabled={Boolean(job)} /><span>사용자 확인: 채택한 자료를 내 환경에서 설치·호출할 수 있습니다.</span></label>}
                {needsExternal && <label><input type="checkbox" checked={externalReady} onChange={(event) => { setExternalReady(event.target.checked); markValidationDirty(); }} disabled={Boolean(job)} /><span>사용자 확인: 외부 처리 서비스를 연결했습니다.</span></label>}
                {needsConsent && <label><input type="checkbox" checked={consentConfirmed} onChange={(event) => { setConsentConfirmed(event.target.checked); markValidationDirty(); }} disabled={Boolean(job)} /><span>사용자 확인: 모든 대상자의 민감 데이터 수집·보관 동의를 확인했습니다.</span></label>}
                {needsSafety && <label><input type="checkbox" checked={safetyConfirmed} onChange={(event) => { setSafetyConfirmed(event.target.checked); markValidationDirty(); }} disabled={Boolean(job)} /><span>사용자 확인: 명세의 중단 조건과 외부 어댑터 영수증 기록 절차를 확인했습니다.</span></label>}
              </div>
              <button type="button" className={styles.validateButton} onClick={() => void runValidation()} disabled={Boolean(busy) || Boolean(job)}>{busy === "validate" ? "확인 기록 중…" : "확인 항목 기록"}</button>
              {validation && <div className={styles.checks}>{validation.checks.map((item) => <article key={item.id} className={item.status === "RECORDED" ? styles.checkPassed : styles.checkBlocked}><i>{item.status === "RECORDED" ? "✓" : "!"}</i><div><small>{item.method === "SERVER_CHECK" ? "서버 형식 확인" : item.method === "CLIENT_REPORTED_PROBE" ? "브라우저 보고" : item.method === "CLIENT_PROBE_AND_USER_ATTESTATION" ? "브라우저+사용자 확인" : "사용자 확인"}</small><strong>{item.label}</strong><p>{item.detail}</p></div></article>)}</div>}
            </aside>
          </div>

          <section className={styles.protocolPanel}>
            <header><div><span>단계별 명세</span><strong>실행기·입출력·STOP 조건</strong></div><small>설계 문서이며 이 사이트가 장치를 실행하지 않습니다.</small></header>
            <ol>{(plan.protocol?.steps ?? []).map((step, index) => <li key={step.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><small>{step.phase} · {executorLabels[step.executor] ?? step.executor}</small><strong>{step.operation}</strong><p>입력 {step.inputs.join(" · ")}<br />출력 {step.outputs.join(" · ")}</p><em>STOP — {step.stopConditions.join(" · ")}</em></div>
            </li>)}</ol>
          </section>

          <section className={styles.executionRail}>
            <div><span>외부 어댑터 전달 준비</span><strong>{job ? "외부 어댑터용 작업 JSON이 저장됐습니다. 아직 전송되지 않았습니다." : validationCurrent && validation?.status === "ATTESTED" ? "현재 선택과 일치하는 확인 기록으로 작업 JSON을 만들 수 있습니다." : validationDirty ? "선택이나 확인이 바뀌어 다시 기록해야 합니다." : "모든 확인 항목을 기록해야 합니다."}</strong><p>이 사이트는 raw serial·관절 명령을 보내지 않습니다. 실제 동작은 별도의 장치 어댑터가 수행하며, 이 사이트는 반환 JSON의 키와 해시 형식만 확인합니다.</p></div>
            <div className={styles.executionActions}>
              {validationCurrent && validation && <button type="button" onClick={() => downloadJson(validation.manifest, `physical-ai-manifest-${plan.id}.json`)}>검토 명세 내려받기</button>}
              {!job && <button type="button" className={styles.issueButton} onClick={() => void issueJob()} disabled={!validationCurrent || validation?.status !== "ATTESTED" || Boolean(busy)}>{busy === "job" ? "JSON 생성 중…" : "외부 어댑터용 JSON 만들기"}</button>}
              {job?.request && <button type="button" className={styles.issueButton} onClick={() => downloadJson(job.request, `device-job-${job.id}.json`)}>작업 JSON 내려받기</button>}
              {job?.request && <Link className={styles.runtimeLink} href={`/runtime?session=${encodeURIComponent(active?.sessionId ?? "")}`}>스마트폰에서 실행 →</Link>}
            </div>
          </section>

          {job && !job.receipt && <form className={styles.receiptPanel} onSubmit={applyReceipt}>
            <div><span>외부 어댑터 영수증 JSON 가져오기</span><strong>작업 {job.id}</strong><p id="adapter-receipt-help">반환 JSON의 작업 키, 요청·설계 해시와 증거 해시 형식을 대조해 기록합니다. 장치 서명이나 측정 내용은 검증하지 않습니다.</p></div>
            <div className={styles.receiptInput}><label htmlFor="adapter-receipt-json">외부 어댑터 영수증 JSON</label>
            <textarea id="adapter-receipt-json" aria-describedby="adapter-receipt-help" value={receiptText} onChange={(event) => setReceiptText(event.target.value)} placeholder={JSON.stringify({
              schema: "campfire.device-receipt.v2",
              job_id: job.id,
              idempotency_key: job.idempotencyKey,
              request_hash_sha256: typeof job.request?.request_hash_sha256 === "string" ? job.request.request_hash_sha256 : "작업 JSON의 request_hash_sha256",
              design_hash_sha256: typeof job.request?.design_hash_sha256 === "string" ? job.request.design_hash_sha256 : plan.designHash,
              status: "SUCCEEDED",
              device_id: "external-adapter-01",
              observed_at: new Date().toISOString(),
              evidence_hash_sha256: "장치 측정 파일의 SHA-256",
              attempt_id: `attempt-${crypto.randomUUID()}`,
              execution_mode: plan.scenario.id === "person_following" ? "ROS2_SIMULATION" : "PHONE_CLOSED_LOOP",
              reason_code: "USER_REPORTED_COMPLETE",
              terminal_step: "evidence_finalized",
              metrics: { sample_count: 1 },
              artifact: { media_type: "application/json", byte_length: 2, hash_sha256: "위와 같은 증거 SHA-256", storage: "USER_DEVICE_ONLY" },
              physical_execution_verified: false,
            }, null, 2)} required /></div>
            <button disabled={busy === "receipt"}>{busy === "receipt" ? "대조 중…" : "영수증 대조·기록"}</button>
          </form>}

          {job?.receipt && <div className={styles.completed}><strong>제출된 영수증 JSON의 키와 해시가 일치합니다.</strong><p>외부 어댑터의 자기 보고를 기록했습니다. 실제 물리 실행 여부, 장치 신원이나 측정 내용의 진실성은 확인하지 않았습니다.</p></div>}
        </>}
      </section>
    </main>
  );
}
