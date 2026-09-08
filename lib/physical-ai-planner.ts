export const PLANNER_VERSION = "campfire-physical-ai-planner/1.3.1";

export const DEVICE_PROFILES = {
  opencat_phone: {
    label: "OpenCat + 스마트폰",
    declaredCapabilities: ["camera_sensor", "microphone_sensor", "motion_sensor", "location_sensor", "clock_sync", "robot_transport"],
  },
  smartphone: {
    label: "스마트폰",
    declaredCapabilities: ["camera_sensor", "microphone_sensor", "motion_sensor", "location_sensor", "clock_sync"],
  },
  opencat: {
    label: "OpenCat",
    declaredCapabilities: ["robot_transport"],
  },
  simulator: {
    label: "시뮬레이터만 사용",
    declaredCapabilities: [],
  },
  custom: {
    label: "직접 구성",
    declaredCapabilities: [],
  },
} as const;

export type DeviceProfileId = keyof typeof DEVICE_PROFILES;
export type PhaseId = "sense" | "interpret" | "decide" | "act" | "verify";
export type RuntimeCapabilityKey = "cameraApi" | "microphoneApi" | "motionApi" | "geolocationApi" | "clockApi" | "serialApi";

export type PlannerCandidate = {
  catalogNodeId: string;
  name: string;
  nodeType: string;
  description: string;
  verificationStatus: string;
  resourceUrl: string | null;
  evidenceUrl: string;
  sourceHash: string;
  score: number;
  evidenceScope: "CATALOG_PROVENANCE_ONLY";
  links: Array<{
    predicate: string;
    targetId: string;
    targetName: string;
    targetType: string;
    targetUrl: string | null;
    evidenceUrl: string;
  }>;
};

export type CapabilityKind = "device" | "catalog" | "workbench" | "external";

export type CapabilityDefinition = {
  id: string;
  label: string;
  phase: PhaseId;
  kind: CapabilityKind;
  why: string;
  terms: readonly string[];
  acceptedNames?: readonly string[];
  runtimeKey?: RuntimeCapabilityKey;
  externalHint?: string;
};

export type PlannedCapability = CapabilityDefinition & {
  status: "WORKBENCH_READY" | "DEVICE_DECLARED" | "CATALOG_CANDIDATE" | "MISSING";
  candidates: PlannerCandidate[];
};

export type ExecutionStep = {
  id: string;
  phase: PhaseId;
  capabilityIds: string[];
  operation: string;
  executor: "browser_sensor_adapter" | "external_model_adapter" | "external_device_adapter" | "workbench";
  inputs: string[];
  outputs: string[];
  stopConditions: string[];
};

export type PhysicalAiPlan = {
  schema: "campfire.physical-ai-design.v1";
  id: string;
  sessionId: string;
  plannerVersion: string;
  designHash: string;
  goal: string;
  successMetric: string;
  constraints: string[];
  scenario: {
    id: ScenarioId;
    title: string;
    confidence: number;
    reason: string;
  };
  device: {
    id: DeviceProfileId;
    label: string;
    declaredCapabilities: readonly string[];
  };
  catalogSnapshotHash: string;
  intentPolicy: {
    allowed: boolean;
    reason: string;
  };
  capabilities: PlannedCapability[];
  stages: Array<{
    id: PhaseId;
    label: string;
    description: string;
    capabilityIds: string[];
  }>;
  initialCoverage: number;
  nextActions: string[];
  observationContract: {
    schema: string;
    requiredFields: string[];
  };
  protocol: {
    mode: "SPECIFICATION_ONLY";
    siteExecutesDevice: false;
    steps: ExecutionStep[];
  };
  createdAt: string;
};

export type RuntimeCapabilities = Record<RuntimeCapabilityKey, boolean>;

export type ValidationInput = {
  selectedResources: Record<string, string>;
  runtime: RuntimeCapabilities;
  deviceConfirmed: boolean;
  softwareReady: boolean;
  externalReady: boolean;
  consentConfirmed: boolean;
  safetyConfirmed: boolean;
};

export type ValidationCheck = {
  id: string;
  label: string;
  status: "RECORDED" | "BLOCKED";
  method: "SERVER_CHECK" | "CLIENT_REPORTED_PROBE" | "USER_ATTESTATION" | "CLIENT_PROBE_AND_USER_ATTESTATION";
  detail: string;
};

export type CapabilityAssessment = {
  capabilityId: string;
  state: "SPECIFIED" | "CLIENT_REPORTED" | "USER_ATTESTED" | "BLOCKED";
  method: ValidationCheck["method"];
  detail: string;
};

export type PlanValidation = {
  status: "ATTESTED" | "BLOCKED";
  checkCoverage: number;
  checks: ValidationCheck[];
  capabilityAssessments: CapabilityAssessment[];
  selectedResources: Array<PlannerCandidate & { capabilityId: string }>;
  manifest: {
    schema: "campfire.physical-ai-experiment.v1";
    validationStatus: "ATTESTED" | "BLOCKED";
    adapterSubmissionAllowed: boolean;
    physicalExecutionAuthorizedBySite: false;
    goal: string;
    scenario: ScenarioId;
    deviceProfile: DeviceProfileId;
    successMetric: string;
    constraints: string[];
    selectedResources: Array<{
      capabilityId: string;
      catalogNodeId: string;
      name: string;
      resourceUrl: string | null;
      evidenceUrl: string;
      sourceHash: string;
    }>;
    observationContract: PhysicalAiPlan["observationContract"];
    stages: PhysicalAiPlan["stages"];
    executionContract: PhysicalAiPlan["protocol"];
    smartphoneRuntime: {
      adapter: "campfire.smartphone-runtime.v1";
      permittedScenarios: Array<"phone_vision_guide" | "gait_route" | "campfire_memory">;
      personFollowingPolicy: "ROS2_SIMULATION_ONLY";
      rawSensorUploadToSite: false;
      rawCameraFramesStored: false;
      rawAudioStored: false;
      evidenceStorage: "USER_DEVICE_ONLY";
      physicalMotionSupported: false;
    };
    ros2: {
      contract: "campfire.ros2-phone-bridge.v1";
      compatibleDistribution: "Jazzy_or_later";
      transport: "rosbridge_websocket_v2";
      bridgeProvidedBySite: false;
      simulationOnly: true;
      topics: Record<string, { name: string; type: string; direction: "publish" | "subscribe" }>;
    };
    evidencePolicy: {
      catalogLinksProveCapability: false;
      selectedByUser: true;
      note: string;
    };
    safety: {
      rawCommandsAllowed: false;
      humanApprovalRequired: true;
      receiptRequired: true;
      physicalExecutionVerifiedBySite: false;
      stopConditions: string[];
    };
  };
};

const CAPABILITIES: Record<string, CapabilityDefinition> = {
  camera_sensor: {
    id: "camera_sensor", label: "카메라 입력", phase: "sense", kind: "device",
    why: "사람이나 장면을 관찰할 영상 입력이 필요합니다.", terms: [], runtimeKey: "cameraApi",
  },
  microphone_sensor: {
    id: "microphone_sensor", label: "마이크 입력", phase: "sense", kind: "device",
    why: "대화를 기록할 음성 입력이 필요합니다.", terms: [], runtimeKey: "microphoneApi",
  },
  motion_sensor: {
    id: "motion_sensor", label: "가속도·자이로 입력", phase: "sense", kind: "device",
    why: "걸음과 흔들림을 시간 순서로 관찰해야 합니다.", terms: [], runtimeKey: "motionApi",
  },
  location_sensor: {
    id: "location_sensor", label: "위치 입력", phase: "sense", kind: "device",
    why: "관찰을 실제 경로 좌표와 연결해야 합니다.", terms: [], runtimeKey: "geolocationApi",
  },
  clock_sync: {
    id: "clock_sync", label: "시간 동기화", phase: "sense", kind: "device",
    why: "센서와 위치 관찰을 같은 시간축에 놓아야 합니다.", terms: [], runtimeKey: "clockApi",
  },
  visual_tracking: {
    id: "visual_tracking", label: "시각 추적 구현 참고", phase: "interpret", kind: "catalog",
    why: "영상에서 목표 대상을 지속적으로 식별할 구현 근거가 필요합니다. 카탈로그 수록은 기능 검증을 뜻하지 않습니다.",
    terms: ["TrackVLA++", "TrackVLA"], acceptedNames: ["trackvla++", "trackvla"],
  },
  spatial_mapping: {
    id: "spatial_mapping", label: "공간·경로 해석", phase: "interpret", kind: "catalog",
    why: "상대 위치나 이동 경로를 행동에 쓸 표현으로 바꿉니다.",
    terms: ["VLMaps", "MapNav", "BeliefMapNav"], acceptedNames: ["vlmaps", "mapnav", "beliefmapnav"],
  },
  embodied_reasoning: {
    id: "embodied_reasoning", label: "상황 해석", phase: "interpret", kind: "catalog",
    why: "관찰과 언어를 현재 상황 및 다음 판단으로 연결합니다.",
    terms: ["Embodied-Reasoner", "CoT-VLA", "Embodied-R"], acceptedNames: ["embodied-reasoner", "cot-vla", "embodied-r"],
  },
  speech_to_text: {
    id: "speech_to_text", label: "음성 전사 연결", phase: "interpret", kind: "external",
    why: "원시 음성을 검색 가능한 발화 기록으로 바꿔야 합니다.", terms: [],
    externalHint: "Clova Speech 또는 동등한 STT API 연결이 필요합니다.",
  },
  gait_sensor_fusion: {
    id: "gait_sensor_fusion", label: "모션·위치 결합 어댑터", phase: "interpret", kind: "workbench",
    why: "스마트폰 런타임이 가속도·자이로·GPS 관찰을 같은 단조 시각으로 결합합니다.", terms: [],
  },
  local_motion_tracking: {
    id: "local_motion_tracking", label: "로컬 움직임 중심 추적", phase: "interpret", kind: "workbench",
    why: "카메라 프레임 차이로 움직임 중심을 계산합니다. 사람 식별이나 신원 인식 기능은 아닙니다.", terms: [],
  },
  phone_feedback: {
    id: "phone_feedback", label: "화면·진동 피드백", phase: "act", kind: "workbench",
    why: "스마트폰 화면과 선택적 진동으로 관찰 결과를 되돌려 작은 폐쇄루프를 만듭니다.", terms: [],
  },
  ros_simulation_bridge: {
    id: "ros_simulation_bridge", label: "ROS 2 시뮬레이션 브리지", phase: "act", kind: "workbench",
    why: "명시적 동의와 시뮬레이션 확인이 있을 때 스마트폰 관찰을 사용자 제공 rosbridge의 시뮬레이터 토픽으로 전달합니다.", terms: [],
  },
  robot_policy: {
    id: "robot_policy", label: "행동 정책", phase: "decide", kind: "catalog",
    why: "관찰을 안전한 다음 행동으로 변환할 정책이 필요합니다.",
    terms: ["OpenVLA", "RT-X", "Octo", "π0"], acceptedNames: ["openvla", "rt-x", "octo", "π0"],
  },
  memory_graph: {
    id: "memory_graph", label: "출처가 남는 상황 기억", phase: "decide", kind: "workbench",
    why: "관찰·판단·결과를 관계와 출처가 있는 객체로 저장합니다.", terms: [],
  },
  privacy_gate: {
    id: "privacy_gate", label: "동의·비공개 처리", phase: "verify", kind: "workbench",
    why: "음성·위치처럼 민감한 관찰은 동의 범위와 함께 다뤄야 합니다.", terms: [],
  },
  robot_transport: {
    id: "robot_transport", label: "OpenCat 장치 어댑터", phase: "act", kind: "device",
    why: "확인 기록이 포함된 고수준 작업을 로봇 어댑터로 전달해야 합니다.", terms: ["OpenCat Quadruped"], runtimeKey: "serialApi",
  },
  opencat_adapter_reference: {
    id: "opencat_adapter_reference", label: "OpenCat 어댑터 구현 참고", phase: "act", kind: "catalog",
    why: "장치 프로토콜을 구현할 공식 프로젝트 출처를 명세에 고정합니다. 연결·동작 검증은 별도입니다.",
    terms: ["OpenCat Quadruped Robot", "OpenCat-Quadruped-Robot"],
    acceptedNames: ["opencat quadruped robot", "opencat-quadruped-robot"],
  },
  simulation: {
    id: "simulation", label: "물리 시뮬레이터", phase: "verify", kind: "catalog",
    why: "장치 실행 전에 정책과 환경 가정을 별도 환경에서 검증합니다.",
    terms: ["Isaac Lab", "MuJoCo Playground", "LocoMuJoCo"], acceptedNames: ["isaac lab", "mujoco playground", "locomujoco"],
  },
  training_data: {
    id: "training_data", label: "학습·평가 데이터", phase: "verify", kind: "catalog",
    why: "설계의 적용 범위와 평가 기준을 실제 데이터로 확인합니다.",
    terms: ["Open X-Embodiment", "LeRobot", "DROID Collaboration", "dataset"],
  },
  safety_receipt: {
    id: "safety_receipt", label: "사람 승인·장치 영수증", phase: "verify", kind: "workbench",
    why: "요청과 외부 어댑터가 제출한 영수증을 함께 남깁니다. 사이트가 실제 실행을 증명하지는 않습니다.", terms: [],
  },
};

export type ScenarioId = "person_following" | "phone_vision_guide" | "campfire_memory" | "gait_route" | "general_physical_ai";

const SCENARIOS: Record<ScenarioId, {
  title: string;
  signalGroups: readonly (readonly string[])[];
  capabilityIds: readonly string[];
  observationSchema: string;
  observationFields: readonly string[];
}> = {
  phone_vision_guide: {
    title: "스마트폰 비전 움직임 안내",
    signalGroups: [
      ["스마트폰", "휴대폰", "phone"],
      ["카메라", "비전", "vision", "camera"],
      ["안내", "진동", "화면", "가이드", "guide", "feedback"],
    ],
    capabilityIds: ["camera_sensor", "local_motion_tracking", "phone_feedback", "ros_simulation_bridge", "privacy_gate", "safety_receipt"],
    observationSchema: "campfire.observation.motion-guide.v1",
    observationFields: ["captured_at", "motion_ratio", "centroid_x", "centroid_y", "confidence"],
  },
  person_following: {
    title: "사람 추종형 사족보행 로봇",
    signalGroups: [
      ["opencat", "오픈캣", "사족", "quadruped"],
      ["따라", "추적", "follow", "following", "tracking"],
      ["사람", "인간", "person", "human", "나를", "사용자", "대상자"],
    ],
    capabilityIds: ["camera_sensor", "visual_tracking", "spatial_mapping", "robot_policy", "robot_transport", "opencat_adapter_reference", "simulation", "privacy_gate", "safety_receipt"],
    observationSchema: "campfire.observation.person-track.v1",
    observationFields: ["captured_at", "person_track_id", "relative_distance_m", "bearing_deg", "confidence"],
  },
  campfire_memory: {
    title: "대화 기반 상황 기억",
    signalGroups: [
      ["모닥불", "대화", "음성", "clova", "클로바", "디코", "discord", "conversation", "speech"],
      ["기억", "기록", "녹음", "전사", "record", "memory", "transcrib"],
    ],
    capabilityIds: ["microphone_sensor", "speech_to_text", "memory_graph", "privacy_gate", "safety_receipt"],
    observationSchema: "campfire.observation.utterance.v1",
    observationFields: ["captured_at", "speaker_label", "utterance_text", "consent_scope", "source_hash"],
  },
  gait_route: {
    title: "스마트폰 보행·경로 관찰",
    signalGroups: [
      ["걸음", "보행", "러닝", "running", "gait", "walk"],
      ["흔들림", "가속도", "자이로", "위치", "경로", "gps", "motion", "route", "location"],
    ],
    capabilityIds: ["motion_sensor", "location_sensor", "clock_sync", "gait_sensor_fusion", "memory_graph", "privacy_gate", "safety_receipt"],
    observationSchema: "campfire.observation.gait-route.v1",
    observationFields: ["captured_at", "accel_xyz", "gyro_xyz", "latitude", "longitude", "accuracy_m"],
  },
  general_physical_ai: {
    title: "일반 Physical AI 실험",
    signalGroups: [],
    capabilityIds: ["camera_sensor", "embodied_reasoning", "robot_policy", "simulation", "training_data", "safety_receipt"],
    observationSchema: "campfire.observation.generic.v1",
    observationFields: ["captured_at", "source_id", "observation_type", "value", "confidence"],
  },
};

const PHASES: Array<{ id: PhaseId; label: string }> = [
  { id: "sense", label: "감지" },
  { id: "interpret", label: "해석" },
  { id: "decide", label: "결정" },
  { id: "act", label: "행동" },
  { id: "verify", label: "검증" },
];

const PROTOCOLS: Record<ScenarioId, ExecutionStep[]> = {
  phone_vision_guide: [
    {
      id: "confirm-camera-consent", phase: "sense", capabilityIds: ["privacy_gate"], operation: "촬영 대상과 목적을 확인하고 로컬 처리 동의를 기록한다.",
      executor: "workbench", inputs: ["participant_consent", "purpose"], outputs: ["local_consent_record"],
      stopConditions: ["동의 없음", "동의 철회", "화면 백그라운드 전환"],
    },
    {
      id: "observe-motion", phase: "sense", capabilityIds: ["camera_sensor"], operation: "카메라 프레임을 로컬에서 읽고 처리 후 즉시 폐기한다.",
      executor: "browser_sensor_adapter", inputs: ["camera_frame"], outputs: ["ephemeral_frame"],
      stopConditions: ["카메라 권한 철회", "영상 입력 중단", "사용자 중단"],
    },
    {
      id: "estimate-motion-centroid", phase: "interpret", capabilityIds: ["local_motion_tracking"], operation: "연속 프레임의 밝기 차이로 움직임 비율과 중심을 계산한다. 사람 신원은 식별하지 않는다.",
      executor: "workbench", inputs: ["ephemeral_frame"], outputs: ["motion_observation"],
      stopConditions: ["표본 없음", "프레임 처리 오류"],
    },
    {
      id: "render-phone-feedback", phase: "act", capabilityIds: ["phone_feedback", "ros_simulation_bridge"], operation: "기본적으로 화면 또는 짧은 진동으로 안내하고, 사용자가 ROS 연결·데이터 전송·시뮬레이션을 모두 확인한 경우에만 같은 관찰을 ROS 2 시뮬레이터로 전달한다.",
      executor: "browser_sensor_adapter", inputs: ["motion_observation", "feedback_consent", "optional_ros_simulation_attestation"], outputs: ["feedback_event", "optional_simulator_feedback"],
      stopConditions: ["피드백 동의 철회", "ROS 임대 만료", "시뮬레이션 확인 철회", "사용자 중단"],
    },
    {
      id: "hash-local-evidence", phase: "verify", capabilityIds: ["safety_receipt"], operation: "로컬 evidence JSON의 실제 바이트를 해시하고 사용자 보고 영수증을 만든다.",
      executor: "workbench", inputs: ["motion_observation", "local_consent_record"], outputs: ["evidence_artifact", "runtime_receipt"],
      stopConditions: ["증거 해시 실패", "필수 측정 누락"],
    },
  ],
  person_following: [
    {
      id: "confirm-target-and-zone", phase: "sense", capabilityIds: ["privacy_gate", "safety_receipt"], operation: "대상자 동의, 추종 대상, 안전 구역과 비상 정지 수단을 확인한다.",
      executor: "external_device_adapter", inputs: ["target_consent", "target_identity", "safe_zone", "e_stop_state"],
      outputs: ["approved_target_session"], stopConditions: ["동의 없음", "비상 정지 미확인", "안전 구역 미설정"],
    },
    {
      id: "observe-target", phase: "sense", capabilityIds: ["camera_sensor"], operation: "카메라 프레임에서 승인된 대상의 프레임 참조를 만든다.",
      executor: "browser_sensor_adapter", inputs: ["camera_frame", "approved_target_session"], outputs: ["target_frame_reference"],
      stopConditions: ["카메라 권한 철회", "승인 대상 세션 만료", "대상 신뢰도 임계값 미만"],
    },
    {
      id: "estimate-relative-pose", phase: "interpret", capabilityIds: ["visual_tracking", "spatial_mapping"], operation: "채택한 추적·공간 구현으로 상대 거리와 방향 관찰을 계산한다.",
      executor: "external_model_adapter", inputs: ["target_frame_reference"], outputs: ["person_track_observation"],
      stopConditions: ["대상 상실", "추정 신뢰도 임계값 미만", "모델 오류"],
    },
    {
      id: "propose-guarded-motion", phase: "decide", capabilityIds: ["robot_policy"], operation: "거리·속도·안전 구역 제한을 적용한 고수준 이동 제안을 만든다.",
      executor: "external_model_adapter", inputs: ["person_track_observation", "safe_zone"], outputs: ["guarded_motion_proposal"],
      stopConditions: ["예상 충돌", "최소 거리 위반", "안전 구역 이탈", "사람 승인 철회"],
    },
    {
      id: "simulate-guarded-motion", phase: "verify", capabilityIds: ["simulation"], operation: "외부 시뮬레이터에서 중단 조건과 거리 제한을 먼저 확인한다.",
      executor: "external_model_adapter", inputs: ["guarded_motion_proposal", "stop_conditions", "success_metric"], outputs: ["simulation_report"],
      stopConditions: ["시뮬레이션 실패", "거리 제한 위반", "중단 조건 미작동"],
    },
    {
      id: "adapter-execution", phase: "act", capabilityIds: ["robot_transport", "opencat_adapter_reference"], operation: "외부 OpenCat 어댑터가 시뮬레이션과 사람 승인 뒤 고수준 제안을 해석한다. 사이트는 명령을 전송하지 않는다.",
      executor: "external_device_adapter", inputs: ["guarded_motion_proposal", "simulation_report", "human_approval"], outputs: ["adapter_receipt", "evidence_artifact"],
      stopConditions: ["대상 상실", "직렬 연결 끊김", "충돌 감지", "비상 정지", "승인 만료"],
    },
    {
      id: "record-adapter-receipt", phase: "verify", capabilityIds: ["safety_receipt"], operation: "외부 어댑터의 작업 키·요청 해시·증거 해시가 담긴 영수증 JSON을 기록한다.",
      executor: "workbench", inputs: ["adapter_receipt", "evidence_artifact"], outputs: ["recorded_external_report"],
      stopConditions: ["작업 키 불일치", "요청·설계 해시 불일치", "증거 해시 누락"],
    },
  ],
  campfire_memory: [
    {
      id: "confirm-recording-consent", phase: "sense", capabilityIds: ["privacy_gate"], operation: "참여자별 수집 동의와 보관 범위를 기록한다.",
      executor: "workbench", inputs: ["participant_consent", "retention_scope"], outputs: ["consent_session"],
      stopConditions: ["동의 없음", "동의 철회", "보관 범위 미정"],
    },
    {
      id: "capture-consented-audio", phase: "sense", capabilityIds: ["microphone_sensor"], operation: "동의 세션 동안만 음성 입력을 관찰한다.",
      executor: "browser_sensor_adapter", inputs: ["microphone_stream", "consent_session"], outputs: ["audio_segment_reference"],
      stopConditions: ["동의 철회", "마이크 권한 철회", "세션 종료"],
    },
    {
      id: "transcribe-and-review", phase: "interpret", capabilityIds: ["speech_to_text"], operation: "외부 STT가 전사 초안을 만들고 사용자가 확정한다.",
      executor: "external_model_adapter", inputs: ["audio_segment_reference"], outputs: ["reviewed_utterance", "external_adapter_receipt", "evidence_artifact"],
      stopConditions: ["외부 서비스 연결 실패", "검토 거부", "동의 범위 불일치"],
    },
    {
      id: "store-provenanced-memory", phase: "decide", capabilityIds: ["memory_graph"], operation: "확정 발화와 출처 해시를 상황 기억 객체·관계로 저장한다.",
      executor: "workbench", inputs: ["reviewed_utterance", "consent_session"], outputs: ["provenanced_memory_object"],
      stopConditions: ["출처 해시 누락", "동의 범위 불일치"],
    },
    {
      id: "audit-memory-scope", phase: "verify", capabilityIds: ["privacy_gate", "memory_graph"], operation: "저장된 발화의 동의 범위·출처 해시·보관 기한을 점검한다.",
      executor: "workbench", inputs: ["provenanced_memory_object", "consent_session", "success_metric"], outputs: ["memory_audit_record"],
      stopConditions: ["동의 범위 불일치", "출처 해시 누락", "보관 기한 누락"],
    },
    {
      id: "record-external-receipt", phase: "verify", capabilityIds: ["safety_receipt"], operation: "외부 STT 어댑터의 작업 키·요청 해시·증거 해시가 담긴 영수증 JSON을 기록한다.",
      executor: "workbench", inputs: ["external_adapter_receipt", "evidence_artifact", "memory_audit_record"], outputs: ["recorded_external_report"],
      stopConditions: ["작업 키 불일치", "요청·설계 해시 불일치", "증거 해시 누락"],
    },
  ],
  gait_route: [
    {
      id: "confirm-location-consent", phase: "sense", capabilityIds: ["privacy_gate"], operation: "위치·모션 수집 범위와 보관 기간을 확인한다.",
      executor: "workbench", inputs: ["participant_consent", "retention_scope"], outputs: ["consent_session"],
      stopConditions: ["동의 없음", "동의 철회"],
    },
    {
      id: "capture-motion-location", phase: "sense", capabilityIds: ["motion_sensor", "location_sensor", "clock_sync"], operation: "브라우저 어댑터가 모션·위치 이벤트와 단조 시각을 기록한다.",
      executor: "browser_sensor_adapter", inputs: ["device_motion", "geolocation", "monotonic_clock"], outputs: ["timestamped_sensor_observation"],
      stopConditions: ["모션 권한 철회", "위치 권한 철회", "시각 기준 손실", "세션 종료"],
    },
    {
      id: "fuse-route-observation", phase: "interpret", capabilityIds: ["gait_sensor_fusion"], operation: "스마트폰 런타임이 단조 시각 기준으로 모션과 위치 관찰을 결합해 경로 관찰 객체와 로컬 증거를 만든다.",
      executor: "workbench", inputs: ["timestamped_sensor_observation"], outputs: ["gait_route_observation", "evidence_artifact"],
      stopConditions: ["필수 필드 누락", "허용 오차 초과"],
    },
    {
      id: "store-route-memory", phase: "decide", capabilityIds: ["memory_graph"], operation: "민감도와 출처를 포함한 경로 기억 객체·관계를 저장한다.",
      executor: "workbench", inputs: ["gait_route_observation", "consent_session"], outputs: ["provenanced_route_memory"],
      stopConditions: ["동의 범위 불일치", "출처 해시 누락"],
    },
    {
      id: "audit-route-quality", phase: "verify", capabilityIds: ["privacy_gate", "gait_sensor_fusion"], operation: "누락 구간·시각 오차·동의 범위를 성공 조건과 대조한다.",
      executor: "workbench", inputs: ["provenanced_route_memory", "success_metric"], outputs: ["route_quality_record"],
      stopConditions: ["누락률 기준 초과", "시각 오차 기준 초과", "동의 범위 불일치"],
    },
    {
      id: "record-phone-runtime-receipt", phase: "verify", capabilityIds: ["safety_receipt"], operation: "스마트폰 로컬 증거의 실제 바이트 해시와 작업 키가 담긴 사용자 보고 영수증 JSON을 기록한다.",
      executor: "workbench", inputs: ["evidence_artifact", "route_quality_record"], outputs: ["recorded_runtime_report"],
      stopConditions: ["작업 키 불일치", "요청·설계 해시 불일치", "증거 해시 누락"],
    },
  ],
  general_physical_ai: [],
};

export function isDeviceProfile(value: unknown): value is DeviceProfileId {
  return typeof value === "string" && value in DEVICE_PROFILES;
}

export function normalizeGoal(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
}

function inspectIntent(goal: string, scenarioId: ScenarioId) {
  const normalized = normalizeGoal(goal);
  const forbidden = [
    "raw serial", "raw_serial", "관절에 직접", "관절 직접", "안전 해제", "e-stop 해제", "비상 정지 해제",
    "공격", "폭행", "해치", "무기", "attack", "assault", "harm", "weapon",
    "몰래 추적", "동의 없이 추적", "동의 없이 촬영", "without consent", "secretly track", "surveillance",
  ];
  const match = forbidden.find((term) => normalized.includes(term));
  if (match) return { allowed: false, reason: `위험·비동의 추적·저수준 제어 표현(${match})이 포함된 요청은 작업 명세로 만들지 않습니다.` };
  const negatedOperations = ["녹음하지", "기록하지", "수집하지", "추적하지", "따라가지 마", "do not record", "don't record", "do not track"];
  const negated = negatedOperations.find((term) => normalized.includes(term));
  if (negated) return { allowed: false, reason: `부정형 요구(${negated})를 반대 의미의 작업으로 변환하지 않습니다. 수행할 긍정 목표로 다시 적어 주세요.` };
  if (scenarioId === "general_physical_ai") {
    return { allowed: false, reason: "현재는 스마트폰 비전 안내, 사람 추종 시뮬레이션, 동의 기반 대화 기억, 스마트폰 보행 경로의 네 가지 명세만 지원합니다." };
  }
  return { allowed: true, reason: "지원하는 고수준 명세 유형입니다. raw serial·관절 직접 명령은 만들지 않습니다." };
}

export function detectScenario(goal: string) {
  const normalized = normalizeGoal(goal);
  const ranked = (Object.entries(SCENARIOS) as Array<[ScenarioId, typeof SCENARIOS[ScenarioId]]>)
    .filter(([id]) => id !== "general_physical_ai")
    .map(([id, scenario]) => {
      const matchesByGroup = scenario.signalGroups.map((group) => group.filter((keyword) => normalized.includes(keyword)));
      const qualified = matchesByGroup.every((matches) => matches.length > 0);
      const matches = matchesByGroup.flat();
      return { id, scenario, matches, qualified };
    })
    .filter((candidate) => candidate.qualified)
    .sort((a, b) => b.matches.length - a.matches.length || a.id.localeCompare(b.id));
  const best = ranked[0];
  if (!best) {
    return { id: "general_physical_ai" as const, ...SCENARIOS.general_physical_ai, confidence: .45, reason: "일반 과업으로 분류했습니다." };
  }
  return {
    id: best.id,
    ...best.scenario,
    confidence: Math.min(.96, .58 + best.matches.length * .08),
    reason: `${best.matches.slice(0, 4).join(", ")} 표현을 근거로 분류했습니다.`,
  };
}

export function getCapabilityDefinitions(goal: string) {
  const scenario = detectScenario(goal);
  return scenario.capabilityIds.map((id) => CAPABILITIES[id]);
}

export function createPlan(input: {
  id: string;
  sessionId: string;
  designHash: string;
  goal: string;
  successMetric: string;
  constraints: string[];
  deviceProfile: DeviceProfileId;
  catalogSnapshotHash: string;
  candidates: Record<string, PlannerCandidate[]>;
  createdAt: string;
}): PhysicalAiPlan {
  const scenario = detectScenario(input.goal);
  const device = DEVICE_PROFILES[input.deviceProfile];
  const capabilities = scenario.capabilityIds.map((id) => {
    const definition = CAPABILITIES[id];
    const candidates = input.candidates[id] ?? [];
    let status: PlannedCapability["status"] = "MISSING";
    if (definition.kind === "workbench") status = "WORKBENCH_READY";
    else if (definition.kind === "device" && device.declaredCapabilities.includes(id as never)) status = "DEVICE_DECLARED";
    else if (definition.kind === "catalog" && candidates.length > 0) status = "CATALOG_CANDIDATE";
    return { ...definition, status, candidates };
  });

  const coverageWeights: Record<PlannedCapability["status"], number> = {
    WORKBENCH_READY: 1,
    DEVICE_DECLARED: 1,
    CATALOG_CANDIDATE: 1,
    MISSING: 0,
  };
  const initialCoverage = Math.round(
    capabilities.reduce((sum, capability) => sum + coverageWeights[capability.status], 0) / capabilities.length * 100,
  );
  const nextActions = capabilities.flatMap((capability) => {
    if (capability.status === "CATALOG_CANDIDATE") return [`${capability.label}: 후보를 채택하고 설치 상태를 확인하세요.`];
    if (capability.status === "DEVICE_DECLARED") return [`${capability.label}: 현재 브라우저와 장치에서 실제 접근 가능 여부를 점검하세요.`];
    if (capability.kind === "external") return [capability.externalHint ?? `${capability.label} 외부 연결이 필요합니다.`];
    if (capability.status === "MISSING") return [`${capability.label}: 제공 장치 또는 어댑터를 연결하세요.`];
    return [];
  });

  return {
    schema: "campfire.physical-ai-design.v1",
    id: input.id,
    sessionId: input.sessionId,
    plannerVersion: PLANNER_VERSION,
    designHash: input.designHash,
    goal: input.goal,
    successMetric: input.successMetric,
    constraints: input.constraints,
    scenario: {
      id: scenario.id,
      title: scenario.title,
      confidence: scenario.confidence,
      reason: scenario.reason,
    },
    device: { id: input.deviceProfile, label: device.label, declaredCapabilities: device.declaredCapabilities },
    catalogSnapshotHash: input.catalogSnapshotHash,
    intentPolicy: inspectIntent(input.goal, scenario.id),
    capabilities,
    stages: PHASES.map((phase) => {
      const phaseCapabilities = capabilities.filter((capability) => capability.phase === phase.id);
      return {
        id: phase.id,
        label: phase.label,
        description: phaseCapabilities.length ? phaseCapabilities.map((capability) => capability.label).join(" · ") : "이 설계에서는 생략",
        capabilityIds: phaseCapabilities.map((capability) => capability.id),
      };
    }),
    initialCoverage,
    nextActions,
    observationContract: {
      schema: scenario.observationSchema,
      requiredFields: [...scenario.observationFields],
    },
    protocol: {
      mode: "SPECIFICATION_ONLY",
      siteExecutesDevice: false,
      steps: PROTOCOLS[scenario.id],
    },
    createdAt: input.createdAt,
  };
}

function check(
  id: string,
  label: string,
  method: ValidationCheck["method"],
  recorded: boolean,
  recordedDetail: string,
  blockedDetail: string,
): ValidationCheck {
  return { id, label, method, status: recorded ? "RECORDED" : "BLOCKED", detail: recorded ? recordedDetail : blockedDetail };
}

export function validatePlan(plan: PhysicalAiPlan, input: ValidationInput): PlanValidation {
  const intentPolicy = inspectIntent(plan.goal, plan.scenario.id);
  const catalogCapabilities = plan.capabilities.filter((capability) => capability.kind === "catalog");
  const selectedResources = catalogCapabilities.flatMap((capability) => {
    const selectedId = input.selectedResources[capability.id];
    const selected = capability.candidates.find((candidate) => candidate.catalogNodeId === selectedId);
    return selected ? [{ ...selected, capabilityId: capability.id }] : [];
  });
  const uncoveredCatalog = catalogCapabilities.filter(
    (capability) => !capability.candidates.some((candidate) => candidate.catalogNodeId === input.selectedResources[capability.id]),
  );
  const deviceCapabilities = plan.capabilities.filter((capability) => capability.kind === "device");
  const deviceMethod: ValidationCheck["method"] = deviceCapabilities.some((capability) => capability.id === "robot_transport")
    ? "CLIENT_PROBE_AND_USER_ATTESTATION"
    : "CLIENT_REPORTED_PROBE";
  const blockedDevice = deviceCapabilities.filter((capability) => {
    const declaredByProfile = plan.device.declaredCapabilities.includes(capability.id);
    const runtimeAvailable = capability.runtimeKey ? input.runtime[capability.runtimeKey] : false;
    if (capability.id === "robot_transport") return !(declaredByProfile && runtimeAvailable && input.deviceConfirmed);
    return !(declaredByProfile && runtimeAvailable);
  });
  const needsExternal = plan.capabilities.some((capability) => capability.kind === "external");
  const needsConsent = plan.capabilities.some((capability) => capability.id === "privacy_gate");
  const needsSafetyApproval = plan.capabilities.some((capability) => capability.id === "safety_receipt");

  const capabilityAssessments: CapabilityAssessment[] = plan.capabilities.map((capability) => {
    if (capability.kind === "catalog") {
      const selected = capability.candidates.some((candidate) => candidate.catalogNodeId === input.selectedResources[capability.id]);
      const recorded = selected && input.softwareReady;
      return {
        capabilityId: capability.id,
        state: recorded ? "USER_ATTESTED" : "BLOCKED",
        method: "USER_ATTESTATION",
        detail: recorded
          ? "사용자가 카탈로그 참고 자료를 선택하고 자신의 환경에서 사용할 수 있다고 확인했습니다. 기능 성능은 사이트가 검증하지 않았습니다."
          : "참고 자료를 선택하고 자신의 환경에서 설치·호출 가능 여부를 확인해야 합니다.",
      };
    }
    if (capability.kind === "device") {
      const declaredByProfile = plan.device.declaredCapabilities.includes(capability.id);
      const runtimeAvailable = capability.runtimeKey ? input.runtime[capability.runtimeKey] : false;
      const recorded = capability.id === "robot_transport"
        ? declaredByProfile && runtimeAvailable && input.deviceConfirmed
        : declaredByProfile && runtimeAvailable;
      return {
        capabilityId: capability.id,
        state: recorded ? "CLIENT_REPORTED" : "BLOCKED",
        method: capability.id === "robot_transport" ? "CLIENT_PROBE_AND_USER_ATTESTATION" : "CLIENT_REPORTED_PROBE",
        detail: recorded
          ? "브라우저가 이 페이지 세션에서 권한 또는 포트 접근 성공을 보고했습니다. 장치 기능은 검증하지 않았습니다."
          : "브라우저가 필요한 권한 또는 포트 접근 성공을 보고하지 않았습니다.",
      };
    }
    if (capability.kind === "external") {
      return {
        capabilityId: capability.id,
        state: input.externalReady ? "USER_ATTESTED" : "BLOCKED",
        method: "USER_ATTESTATION",
        detail: input.externalReady ? "사용자가 외부 서비스 연결을 확인했습니다." : "외부 서비스 연결에 대한 사용자 확인이 필요합니다.",
      };
    }
    if (capability.id === "privacy_gate") {
      return {
        capabilityId: capability.id,
        state: input.consentConfirmed ? "USER_ATTESTED" : "BLOCKED",
        method: "USER_ATTESTATION",
        detail: input.consentConfirmed ? "사용자가 민감 데이터 동의 범위를 확인했습니다." : "민감 데이터 동의 범위 확인이 필요합니다.",
      };
    }
    if (capability.id === "safety_receipt") {
      return {
        capabilityId: capability.id,
        state: input.safetyConfirmed ? "USER_ATTESTED" : "BLOCKED",
        method: "USER_ATTESTATION",
        detail: input.safetyConfirmed ? "사용자가 명세의 중단 조건과 외부 영수증 기록 절차를 확인했습니다." : "중단 조건과 외부 영수증 기록 절차 확인이 필요합니다.",
      };
    }
    return {
      capabilityId: capability.id,
      state: "SPECIFIED",
      method: "SERVER_CHECK",
      detail: "작업대가 객체·관계와 출처를 저장할 구조를 제공합니다.",
    };
  });

  const checks = [
    check("intent", "지원되는 고수준 명세", "SERVER_CHECK", intentPolicy.allowed, intentPolicy.reason, intentPolicy.reason),
    check("goal", "목표와 성공 조건", "SERVER_CHECK", Boolean(plan.goal && plan.successMetric), "목표와 판정 문장이 저장됐습니다.", "성공 조건을 수치나 판정 문장으로 정의하세요."),
    check("evidence", "온톨로지 참고 자료 선택", "SERVER_CHECK", uncoveredCatalog.length === 0, `${selectedResources.length}개 참고 자료와 출처를 명세에 연결했습니다. 기능 검증을 뜻하지 않습니다.`, `${uncoveredCatalog.map((item) => item.label).join(", ")} 참고 자료를 하나씩 선택하세요.`),
    check("software", "소프트웨어 사용 가능 여부", "USER_ATTESTATION", catalogCapabilities.length === 0 || input.softwareReady, "사용자가 선택 자료의 설치·호출 가능 여부를 확인했습니다.", "선택한 자료를 자신의 환경에서 설치·호출할 수 있는지 확인하세요."),
    check("device", "브라우저 권한·포트 접근", deviceMethod, blockedDevice.length === 0, "브라우저가 필요한 권한·포트 접근 성공을 보고했으며, 필요한 경우 사용자가 어댑터 연결을 별도 확인했습니다. 센서 품질과 장치 기능은 검증하지 않았습니다.", `${blockedDevice.map((item) => item.label).join(", ")} 접근 또는 사용자 확인이 기록되지 않았습니다.`),
    check("external", "외부 서비스 연결", "USER_ATTESTATION", !needsExternal || input.externalReady, "사용자가 외부 처리 연결을 확인했습니다.", "음성 전사 등 외부 서비스 연결을 확인하세요."),
    check("consent", "민감 데이터 동의", "USER_ATTESTATION", !needsConsent || input.consentConfirmed, "사용자가 음성·영상·위치 데이터의 동의 범위를 확인했습니다.", "민감 데이터 수집·보관 동의를 확인하세요."),
    check("safety", "중단 조건·외부 영수증 절차", "USER_ATTESTATION", !needsSafetyApproval || input.safetyConfirmed, "사용자가 명세의 중단 조건과 외부 영수증 기록 절차를 확인했습니다.", "외부 어댑터 전달 전 중단 조건과 영수증 기록 절차를 확인하세요."),
    check("receipt", "외부 어댑터 영수증 형식", "SERVER_CHECK", true, "사이트는 요청·설계 해시가 일치하는 영수증을 기록하지만 물리 실행은 증명하지 않습니다.", ""),
  ];
  const recordedCount = checks.filter((item) => item.status === "RECORDED").length;
  const status = checks.every((item) => item.status === "RECORDED") ? "ATTESTED" : "BLOCKED";
  const executionContract = plan.protocol ?? {
    mode: "SPECIFICATION_ONLY" as const,
    siteExecutesDevice: false as const,
    steps: PROTOCOLS[plan.scenario.id],
  };
  const stopConditions = [...new Set(executionContract.steps.flatMap((step) => step.stopConditions))];
  return {
    status,
    checkCoverage: Math.round(recordedCount / checks.length * 100),
    checks,
    capabilityAssessments,
    selectedResources,
    manifest: {
      schema: "campfire.physical-ai-experiment.v1",
      validationStatus: status,
      adapterSubmissionAllowed: status === "ATTESTED",
      physicalExecutionAuthorizedBySite: false,
      goal: plan.goal,
      scenario: plan.scenario.id,
      deviceProfile: plan.device.id,
      successMetric: plan.successMetric,
      constraints: plan.constraints,
      selectedResources: selectedResources.map((candidate) => ({
        capabilityId: candidate.capabilityId,
        catalogNodeId: candidate.catalogNodeId,
        name: candidate.name,
        resourceUrl: candidate.resourceUrl,
        evidenceUrl: candidate.evidenceUrl,
        sourceHash: candidate.sourceHash,
      })),
      observationContract: plan.observationContract,
      stages: plan.stages,
      executionContract,
      smartphoneRuntime: {
        adapter: "campfire.smartphone-runtime.v1",
        permittedScenarios: ["phone_vision_guide", "gait_route", "campfire_memory"],
        personFollowingPolicy: "ROS2_SIMULATION_ONLY",
        rawSensorUploadToSite: false,
        rawCameraFramesStored: false,
        rawAudioStored: false,
        evidenceStorage: "USER_DEVICE_ONLY",
        physicalMotionSupported: false,
      },
      ros2: {
        contract: "campfire.ros2-phone-bridge.v1",
        compatibleDistribution: "Jazzy_or_later",
        transport: "rosbridge_websocket_v2",
        bridgeProvidedBySite: false,
        simulationOnly: true,
        topics: {
          imu: { name: "/campfire/phone/imu", type: "sensor_msgs/msg/Imu", direction: "publish" },
          navsat: { name: "/campfire/phone/navsat", type: "sensor_msgs/msg/NavSatFix", direction: "publish" },
          vision: { name: "/campfire/phone/vision", type: "std_msgs/msg/String", direction: "publish" },
          transcript: { name: "/campfire/phone/transcript", type: "std_msgs/msg/String", direction: "publish" },
          runtime: { name: "/campfire/phone/runtime", type: "std_msgs/msg/String", direction: "publish" },
          feedback: { name: "/campfire/phone/feedback", type: "std_msgs/msg/String", direction: "subscribe" },
        },
      },
      evidencePolicy: {
        catalogLinksProveCapability: false,
        selectedByUser: true,
        note: "카탈로그 링크는 출처가 있는 구현 참고 자료이며 설치 상태나 기능 성능을 증명하지 않습니다.",
      },
      safety: {
        rawCommandsAllowed: false,
        humanApprovalRequired: true,
        receiptRequired: true,
        physicalExecutionVerifiedBySite: false,
        stopConditions,
      },
    },
  };
}
