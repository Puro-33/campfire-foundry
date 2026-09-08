/**
 * Browser-safe helpers shared by the smartphone runtime and its server routes.
 *
 * Hashing deliberately uses Web Crypto so the same implementation works in a
 * browser, Node 22, and the Cloudflare worker runtime used by this project.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

export const PHONE_RUNTIME_VERSION = "campfire-smartphone-runtime/1.0.0" as const;
export const DEVICE_JOB_SCHEMAS = ["campfire.device-job.v2", "campfire.device-job.v3"] as const;
/** Current schema; validation also accepts every value in `DEVICE_JOB_SCHEMAS`. */
export const DEVICE_JOB_SCHEMA = "campfire.device-job.v3" as const;
export const RUNTIME_EVIDENCE_SCHEMA = "campfire.runtime-evidence.v2" as const;
export const RUNTIME_RECEIPT_SCHEMA = "campfire.device-receipt.v2" as const;

export const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
export const RECEIPT_STATUSES = ["SUCCEEDED", "FAILED", "ABORTED"] as const;

export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export type RuntimeScenario = "person_following" | "phone_vision_guide" | "gait_route" | "campfire_memory";
export type ExecutionMode = "PHONE_CLOSED_LOOP" | "ROS2_SIMULATION";
export type DeviceJobSchema = (typeof DEVICE_JOB_SCHEMAS)[number];

export type ReceiptContract = {
  schema: string;
  required_fields: string[];
  accepted_statuses: string[];
  copy_from_request: string[];
  request_hash_source: string;
  evidence_hash_format: string;
  verification_scope: string;
  physical_execution_verified_by_site: boolean;
};

export type DeviceJobRequest = {
  schema: DeviceJobSchema;
  job_id: string;
  manifest_id: string;
  design_id: string;
  design_hash_sha256: string;
  validation_id: string;
  idempotency_key: string;
  intent: "SUBMIT_EXPERIMENT_MANIFEST";
  issued_at: string;
  delivery_status: string;
  execution_authority: "EXTERNAL_ADAPTER_REQUIRED" | "BROWSER_OR_EXTERNAL_ADAPTER_REQUIRED";
  physical_execution_verified_by_site: false;
  device_profile: string;
  goal: string;
  experiment: JsonValue;
  receipt_contract: ReceiptContract;
  safety: {
    raw_serial_allowed: boolean;
    joint_commands_allowed: boolean;
    physical_hardware_allowed_by_smartphone_runtime?: boolean;
    person_following_mode?: string;
    human_approval_required: boolean;
    receipt_required: boolean;
  };
  request_hash_sha256: string;
};

/** A job that is explicitly authorized to start inside the browser runtime. */
export type BrowserRuntimeJobRequest = DeviceJobRequest & {
  schema: "campfire.device-job.v3";
  execution_authority: "BROWSER_OR_EXTERNAL_ADAPTER_REQUIRED";
};

export type RuntimeObservation = {
  kind: "imu" | "navsat" | "vision" | "transcript" | "runtime" | "feedback" | string;
  observed_at: string;
  payload: JsonValue;
  topic?: string;
};

/** The JSON object whose serialized bytes become the evidence artifact. */
export type RuntimeEvidence = {
  schema: typeof RUNTIME_EVIDENCE_SCHEMA;
  job_id: string;
  request_hash_sha256: string;
  design_hash_sha256: string;
  device_id: string;
  started_at: string;
  observed_at: string;
  source: "SMARTPHONE_BROWSER";
  observations: RuntimeObservation[];
  summary: JsonRecord;
  physical_execution_verified_by_site: false;
};

export type EvidenceArtifact = {
  evidence: RuntimeEvidence;
  /** Exact text encoded into `bytes` and `blob`. */
  json: string;
  /** Exact bytes hashed by `hashSha256`. */
  bytes: Uint8Array;
  blob: Blob;
  byteLength: number;
  hashSha256: string;
  /** Snake-case alias used by the receipt wire format. */
  evidence_hash_sha256: string;
  fileName: string;
};

export type RuntimeReceiptV2 = {
  schema: typeof RUNTIME_RECEIPT_SCHEMA;
  job_id: string;
  idempotency_key: string;
  status: ReceiptStatus;
  device_id: string;
  observed_at: string;
  evidence_hash_sha256: string;
  request_hash_sha256: string;
  design_hash_sha256: string;
  attempt_id: string;
  execution_mode: ExecutionMode;
  reason_code: string;
  terminal_step: string;
  metrics: RuntimeReceiptMetrics;
  artifact: {
    media_type: "application/json";
    byte_length: number;
    hash_sha256: string;
    storage: "USER_DEVICE_ONLY";
  };
  verification_scope: "SERVER_JOB_KEYS_AND_HASH_FORMAT_PLUS_CLIENT_HASHED_LOCAL_ARTIFACT_CLAIM";
  physical_execution_verified: false;
  receipt_hash_sha256: string;
};

export type RuntimeReceiptMetric = string | number | boolean | null;
export type RuntimeReceiptMetrics = Record<string, RuntimeReceiptMetric>;

export type RuntimeJobValidation = {
  job: BrowserRuntimeJobRequest;
  requestHashSha256: string;
  serverCopyMatched: true;
};

export class RuntimeContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RuntimeContractError";
    this.code = code;
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function bytesForDigest(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytesForDigest(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Text(text: string): Promise<string> {
  return sha256Bytes(textEncoder.encode(text));
}

export async function sha256Json(value: unknown): Promise<string> {
  const json = JSON.stringify(value);
  if (json === undefined) throw new RuntimeContractError("INVALID_JSON", "값을 JSON으로 직렬화할 수 없습니다.");
  return sha256Text(json);
}

type BinaryJsonSource = string | Uint8Array | ArrayBuffer | Blob;
export type RuntimeJsonSource = BinaryJsonSource | Record<string, unknown>;

async function sourceBytes(source: BinaryJsonSource): Promise<Uint8Array> {
  if (typeof source === "string") return textEncoder.encode(source);
  if (source instanceof Uint8Array) return bytesForDigest(source);
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  return new Uint8Array(await source.arrayBuffer());
}

/** Hash an evidence file/blob without parsing or re-serializing it. */
export async function hashEvidenceBytes(source: BinaryJsonSource): Promise<string> {
  return sha256Bytes(await sourceBytes(source));
}

/** Validate that the supplied bytes are JSON, then hash those unchanged bytes. */
export async function hashEvidenceJsonBytes(source: BinaryJsonSource): Promise<string> {
  const bytes = await sourceBytes(source);
  try {
    JSON.parse(textDecoder.decode(bytes));
  } catch {
    throw new RuntimeContractError("INVALID_EVIDENCE_JSON", "증거 파일이 유효한 UTF-8 JSON이 아닙니다.");
  }
  return sha256Bytes(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertJsonValue(value: unknown, path = "$", seen = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new RuntimeContractError("INVALID_JSON", `${path}에는 유한한 숫자만 사용할 수 있습니다.`);
  }
  if (typeof value !== "object") {
    throw new RuntimeContractError("INVALID_JSON", `${path}에는 JSON 값만 사용할 수 있습니다.`);
  }
  if (seen.has(value)) throw new RuntimeContractError("INVALID_JSON", `${path}에 순환 참조가 있습니다.`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

async function parseJsonSource(source: RuntimeJsonSource): Promise<Record<string, unknown>> {
  let parsed: unknown = source;
  if (typeof source === "string") {
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new RuntimeContractError("INVALID_JOB_JSON", "작업 파일이 유효한 JSON이 아닙니다.");
    }
  } else if (source instanceof Uint8Array || source instanceof ArrayBuffer || source instanceof Blob) {
    try {
      parsed = JSON.parse(textDecoder.decode(await sourceBytes(source)));
    } catch {
      throw new RuntimeContractError("INVALID_JOB_JSON", "작업 파일이 유효한 UTF-8 JSON이 아닙니다.");
    }
  }
  if (!isRecord(parsed)) throw new RuntimeContractError("INVALID_JOB", "작업 JSON은 객체여야 합니다.");

  // API records may wrap the persisted request. Accept both common wrappers
  // while validating the inner request as the authoritative value.
  if (isRecord(parsed.request)) return parsed.request;
  if (typeof parsed.request_json === "string") return parseJsonSource(parsed.request_json);
  return parsed;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new RuntimeContractError("INVALID_JOB", `작업 JSON의 ${key} 값이 없거나 올바르지 않습니다.`);
  }
  return value;
}

function assertSha256(value: string, field: string): string {
  const normalized = value.toLocaleLowerCase("en-US");
  if (!SHA256_HEX_PATTERN.test(normalized)) {
    throw new RuntimeContractError("INVALID_SHA256", `${field}는 64자리 SHA-256 16진수여야 합니다.`);
  }
  return normalized;
}

function assertIsoDate(value: string, field: string): void {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new RuntimeContractError("INVALID_TIMESTAMP", `${field}는 정규화된 ISO 날짜여야 합니다.`);
  }
}

function assertDeviceJob(record: Record<string, unknown>): asserts record is DeviceJobRequest {
  assertJsonValue(record);
  if (!DEVICE_JOB_SCHEMAS.includes(record.schema as DeviceJobSchema)) {
    throw new RuntimeContractError("WRONG_JOB_SCHEMA", `${DEVICE_JOB_SCHEMAS.join(" 또는 ")} 작업만 실행할 수 있습니다.`);
  }
  if (record.intent !== "SUBMIT_EXPERIMENT_MANIFEST") {
    throw new RuntimeContractError("WRONG_JOB_INTENT", "지원하지 않는 작업 intent입니다.");
  }
  const expectedAuthority = record.schema === "campfire.device-job.v3"
    ? "BROWSER_OR_EXTERNAL_ADAPTER_REQUIRED"
    : "EXTERNAL_ADAPTER_REQUIRED";
  if (record.execution_authority !== expectedAuthority) {
    throw new RuntimeContractError("WRONG_EXECUTION_AUTHORITY", "외부 어댑터용 작업만 실행할 수 있습니다.");
  }
  if (record.physical_execution_verified_by_site !== false) {
    throw new RuntimeContractError("INVALID_VERIFICATION_CLAIM", "사이트의 물리 실행 검증을 주장하는 작업은 거부됩니다.");
  }

  for (const key of [
    "job_id", "manifest_id", "design_id", "validation_id", "idempotency_key",
    "device_profile", "goal", "issued_at", "request_hash_sha256", "design_hash_sha256",
  ]) requiredString(record, key);

  assertIsoDate(record.issued_at as string, "issued_at");
  assertSha256(record.request_hash_sha256 as string, "request_hash_sha256");
  assertSha256(record.design_hash_sha256 as string, "design_hash_sha256");
  if (!("experiment" in record)) throw new RuntimeContractError("INVALID_JOB", "작업 JSON에 experiment가 없습니다.");
  if (!isRecord(record.receipt_contract)) throw new RuntimeContractError("INVALID_JOB", "receipt_contract가 올바르지 않습니다.");
  if (!isRecord(record.safety)) throw new RuntimeContractError("INVALID_JOB", "safety 계약이 올바르지 않습니다.");
  if (record.safety.human_approval_required !== true || record.safety.receipt_required !== true) {
    throw new RuntimeContractError("UNSAFE_JOB", "사람 승인과 영수증을 요구하지 않는 작업은 실행할 수 없습니다.");
  }
}

/**
 * Runtime authorization is intentionally narrower than receipt compatibility.
 * Legacy v2 jobs remain parseable for server/API receipt handling, but never
 * grant execution authority to the browser runtime.
 */
function assertBrowserRuntimeJob(
  record: Record<string, unknown>,
): asserts record is BrowserRuntimeJobRequest {
  assertDeviceJob(record);
  if (record.schema !== "campfire.device-job.v3") {
    throw new RuntimeContractError(
      "RUNTIME_SCHEMA_NOT_AUTHORIZED",
      "브라우저 런타임은 campfire.device-job.v3 작업만 시작할 수 있습니다.",
    );
  }
  if (record.execution_authority !== "BROWSER_OR_EXTERNAL_ADAPTER_REQUIRED") {
    throw new RuntimeContractError(
      "RUNTIME_AUTHORITY_NOT_GRANTED",
      "작업에 브라우저 실행 권한이 없습니다.",
    );
  }
}

function withoutRequestHash(job: DeviceJobRequest): Omit<DeviceJobRequest, "request_hash_sha256"> {
  const copy = { ...job };
  delete (copy as Partial<DeviceJobRequest>).request_hash_sha256;
  return copy;
}

/**
 * Validate an imported phone job against the server-persisted copy and its
 * server-compatible request SHA-256. Object key order in the imported file is
 * ignored for the copy comparison; the hash is recomputed from the authoritative
 * server copy using the server's `JSON.stringify` byte convention.
 */
export async function validateRuntimeJob(
  candidateSource: RuntimeJsonSource,
  serverStoredSource: RuntimeJsonSource,
): Promise<RuntimeJobValidation> {
  const candidate = await parseJsonSource(candidateSource);
  const serverStored = await parseJsonSource(serverStoredSource);
  assertBrowserRuntimeJob(candidate);
  assertBrowserRuntimeJob(serverStored);

  if (canonicalJson(candidate) !== canonicalJson(serverStored)) {
    throw new RuntimeContractError("SERVER_COPY_MISMATCH", "가져온 작업 JSON이 서버 저장본과 일치하지 않습니다.");
  }

  const requestHashSha256 = await sha256Json(withoutRequestHash(serverStored));
  const claimedServerHash = assertSha256(serverStored.request_hash_sha256, "request_hash_sha256");
  const claimedCandidateHash = assertSha256(candidate.request_hash_sha256, "request_hash_sha256");
  if (requestHashSha256 !== claimedServerHash || claimedCandidateHash !== claimedServerHash) {
    throw new RuntimeContractError("REQUEST_HASH_MISMATCH", "작업 JSON의 request SHA-256이 서버 저장본과 일치하지 않습니다.");
  }

  return { job: candidate, requestHashSha256, serverCopyMatched: true };
}

/** Explicit browser-runtime name retained alongside the UI-facing helper. */
export const validateDeviceJob = validateRuntimeJob;

function assertRuntimeEvidence(evidence: RuntimeEvidence): void {
  assertJsonValue(evidence);
  if (evidence.schema !== RUNTIME_EVIDENCE_SCHEMA) {
    throw new RuntimeContractError("WRONG_EVIDENCE_SCHEMA", `${RUNTIME_EVIDENCE_SCHEMA} 증거만 만들 수 있습니다.`);
  }
  for (const key of ["job_id", "device_id", "started_at", "observed_at"] as const) {
    if (!evidence[key]) throw new RuntimeContractError("INVALID_EVIDENCE", `증거의 ${key} 값이 필요합니다.`);
  }
  assertSha256(evidence.request_hash_sha256, "request_hash_sha256");
  assertSha256(evidence.design_hash_sha256, "design_hash_sha256");
  assertIsoDate(evidence.started_at, "started_at");
  assertIsoDate(evidence.observed_at, "observed_at");
  if (evidence.source !== "SMARTPHONE_BROWSER" || evidence.physical_execution_verified_by_site !== false) {
    throw new RuntimeContractError("INVALID_EVIDENCE_CLAIM", "스마트폰 런타임의 검증 범위를 벗어난 증거입니다.");
  }
  if (!Array.isArray(evidence.observations)) {
    throw new RuntimeContractError("INVALID_EVIDENCE", "observations는 배열이어야 합니다.");
  }
}

/**
 * Serialize once, then use the same bytes for the downloadable blob and hash.
 * This is intentionally different from hashing a parsed/re-serialized upload.
 */
export async function createEvidenceArtifact(
  evidence: RuntimeEvidence,
  options: { space?: number; trailingNewline?: boolean; fileName?: string } = {},
): Promise<EvidenceArtifact> {
  assertRuntimeEvidence(evidence);
  const space = Math.min(10, Math.max(0, Math.trunc(options.space ?? 2)));
  const json = `${JSON.stringify(evidence, null, space)}${options.trailingNewline === false ? "" : "\n"}`;
  const bytes = textEncoder.encode(json);
  const hashSha256 = await sha256Bytes(bytes);
  const blobBytes = bytesForDigest(bytes);
  return {
    evidence,
    json,
    bytes,
    blob: new Blob([blobBytes], { type: "application/json;charset=utf-8" }),
    byteLength: bytes.byteLength,
    hashSha256,
    evidence_hash_sha256: hashSha256,
    fileName: options.fileName ?? `campfire-evidence-${evidence.job_id}.json`,
  };
}

export type CreateRuntimeReceiptInput = {
  job: DeviceJobRequest;
  deviceId: string;
  status: ReceiptStatus;
  observedAt?: string | Date;
  evidenceHashSha256: string;
  evidenceByteLength?: number;
  attemptId?: string;
  executionMode?: ExecutionMode;
  reasonCode?: string;
  terminalStep?: string;
  metrics?: RuntimeReceiptMetrics;
};

function runtimeScenario(job: DeviceJobRequest): RuntimeScenario | null {
  if (!isRecord(job.experiment)) return null;
  const scenario = job.experiment.scenario;
  return typeof scenario === "string" && [
    "person_following", "phone_vision_guide", "gait_route", "campfire_memory",
  ].includes(scenario) ? scenario as RuntimeScenario : null;
}

function validateReceiptMetrics(metrics: RuntimeReceiptMetrics): void {
  const entries = Object.entries(metrics);
  if (entries.length < 1 || entries.length > 32 || entries.some(([key, value]) => (
    key.length === 0 || key.length > 80
    || !(value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    || (typeof value === "number" && !Number.isFinite(value))
  ))) {
    throw new RuntimeContractError("INVALID_RECEIPT_METRICS", "metrics는 1~32개의 단순 JSON 값이어야 합니다.");
  }
}

/** Create a receipt v2 bound to a validated job and the exact evidence bytes. */
export async function createRuntimeReceipt(input: CreateRuntimeReceiptInput): Promise<RuntimeReceiptV2> {
  assertDeviceJob(input.job);
  if (!RECEIPT_STATUSES.includes(input.status)) {
    throw new RuntimeContractError("INVALID_RECEIPT_STATUS", "영수증 상태가 올바르지 않습니다.");
  }
  if (input.deviceId.trim().length < 2 || input.deviceId.length > 160) {
    throw new RuntimeContractError("INVALID_DEVICE_ID", "장치 ID는 2~160자여야 합니다.");
  }
  const observedAt = input.observedAt instanceof Date
    ? input.observedAt.toISOString()
    : input.observedAt ?? new Date().toISOString();
  assertIsoDate(observedAt, "observed_at");
  const evidenceHash = assertSha256(input.evidenceHashSha256, "evidence_hash_sha256");
  if (!Number.isSafeInteger(input.evidenceByteLength) || (input.evidenceByteLength ?? 0) < 2 || (input.evidenceByteLength ?? 0) > 5_000_000) {
    throw new RuntimeContractError("INVALID_EVIDENCE_LENGTH", "evidenceByteLength는 2~5,000,000 범위의 정수여야 합니다.");
  }

  const recomputedRequestHash = await sha256Json(withoutRequestHash(input.job));
  if (recomputedRequestHash !== input.job.request_hash_sha256.toLocaleLowerCase("en-US")) {
    throw new RuntimeContractError("REQUEST_HASH_MISMATCH", "영수증을 만들 작업의 request SHA-256이 올바르지 않습니다.");
  }

  const attemptId = input.attemptId ?? `attempt:${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
  if (attemptId.length < 8 || attemptId.length > 180 || !/^[a-zA-Z0-9_.:-]+$/.test(attemptId)) {
    throw new RuntimeContractError("INVALID_ATTEMPT_ID", "attemptId 형식이 올바르지 않습니다.");
  }
  const scenario = runtimeScenario(input.job);
  const executionMode = input.executionMode ?? (scenario === "person_following" ? "ROS2_SIMULATION" : "PHONE_CLOSED_LOOP");
  if (scenario === "person_following" && executionMode !== "ROS2_SIMULATION") {
    throw new RuntimeContractError("UNSAFE_EXECUTION_MODE", "사람 추종 시나리오는 ROS2 시뮬레이션으로만 보고할 수 있습니다.");
  }
  const reasonCode = (input.reasonCode ?? ({
    SUCCEEDED: "COMPLETED",
    FAILED: "RUNTIME_ERROR",
    ABORTED: "USER_ABORTED",
  } satisfies Record<ReceiptStatus, string>)[input.status]).toLocaleUpperCase("en-US");
  if (reasonCode.length < 3 || reasonCode.length > 80 || !/^[A-Z0-9_]+$/.test(reasonCode)) {
    throw new RuntimeContractError("INVALID_REASON_CODE", "reasonCode는 3~80자의 영문 대문자, 숫자, 밑줄이어야 합니다.");
  }
  const terminalStep = input.terminalStep?.trim() || "evidence_finalized";
  if (terminalStep.length < 2 || terminalStep.length > 120) {
    throw new RuntimeContractError("INVALID_TERMINAL_STEP", "terminalStep은 2~120자여야 합니다.");
  }
  const metrics = input.metrics ?? { runtime_version: PHONE_RUNTIME_VERSION };
  validateReceiptMetrics(metrics);

  const receiptBase = {
    schema: RUNTIME_RECEIPT_SCHEMA,
    job_id: input.job.job_id,
    idempotency_key: input.job.idempotency_key,
    status: input.status,
    device_id: input.deviceId.trim(),
    observed_at: observedAt,
    evidence_hash_sha256: evidenceHash,
    request_hash_sha256: recomputedRequestHash,
    design_hash_sha256: input.job.design_hash_sha256.toLocaleLowerCase("en-US"),
    attempt_id: attemptId,
    execution_mode: executionMode,
    reason_code: reasonCode,
    terminal_step: terminalStep,
    metrics,
    artifact: {
      media_type: "application/json" as const,
      byte_length: input.evidenceByteLength as number,
      hash_sha256: evidenceHash,
      storage: "USER_DEVICE_ONLY" as const,
    },
    verification_scope: "SERVER_JOB_KEYS_AND_HASH_FORMAT_PLUS_CLIENT_HASHED_LOCAL_ARTIFACT_CLAIM" as const,
    physical_execution_verified: false as const,
  };
  return { ...receiptBase, receipt_hash_sha256: await sha256Json(receiptBase) };
}

export type GeoPoint = { latitude: number; longitude: number };

function assertCoordinate(point: GeoPoint): void {
  if (!Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90) {
    throw new RangeError("latitude must be a finite number between -90 and 90");
  }
  if (!Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) {
    throw new RangeError("longitude must be a finite number between -180 and 180");
  }
}

export function haversineMeters(from: GeoPoint, to: GeoPoint): number;
export function haversineMeters(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number): number;
export function haversineMeters(
  fromOrLatitude: GeoPoint | number,
  toOrLongitude: GeoPoint | number,
  maybeToLatitude?: number,
  maybeToLongitude?: number,
): number {
  const from = typeof fromOrLatitude === "number"
    ? { latitude: fromOrLatitude, longitude: toOrLongitude as number }
    : fromOrLatitude;
  const to = typeof fromOrLatitude === "number"
    ? { latitude: maybeToLatitude as number, longitude: maybeToLongitude as number }
    : toOrLongitude as GeoPoint;
  assertCoordinate(from);
  assertCoordinate(to);
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export const haversineDistanceMeters = haversineMeters;

export type RosTopicDirection = "publish" | "subscribe";
export type RosTopicContract = Readonly<{
  /** `name` and `topic` intentionally alias one another for client compatibility. */
  name: string;
  topic: string;
  type: string;
  direction: RosTopicDirection;
}>;

function rosTopic(topic: string, type: string, direction: RosTopicDirection): RosTopicContract {
  return Object.freeze({ name: topic, topic, type, direction });
}

/** Agreed ROS 2/rosbridge topic contract for the phone runtime. */
export const ROS_TOPICS = Object.freeze({
  imu: rosTopic("/campfire/phone/imu", "sensor_msgs/msg/Imu", "publish"),
  navsat: rosTopic("/campfire/phone/navsat", "sensor_msgs/msg/NavSatFix", "publish"),
  vision: rosTopic("/campfire/phone/vision", "std_msgs/msg/String", "publish"),
  transcript: rosTopic("/campfire/phone/transcript", "std_msgs/msg/String", "publish"),
  runtime: rosTopic("/campfire/phone/runtime", "std_msgs/msg/String", "publish"),
  feedback: rosTopic("/campfire/phone/feedback", "std_msgs/msg/String", "subscribe"),
});

export type RosTopicKey = keyof typeof ROS_TOPICS;
export const ROS_PUBLISH_TOPICS = Object.freeze(Object.values(ROS_TOPICS).filter((topic) => topic.direction === "publish"));
export const ROS_SUBSCRIBE_TOPICS = Object.freeze(Object.values(ROS_TOPICS).filter((topic) => topic.direction === "subscribe"));

type RosTopicInput = string | Pick<RosTopicContract, "topic" | "type">;
type RosMessage = Record<string, unknown>;

function resolveRosTopic(input: RosTopicInput, explicitType?: string): { topic: string; type?: string } {
  if (typeof input === "string") return { topic: input, type: explicitType };
  return { topic: input.topic, type: explicitType ?? input.type };
}

export type RosbridgeAdvertise = {
  op: "advertise";
  topic: string;
  type: string;
  id?: string;
  latch?: boolean;
  queue_size?: number;
};

export type RosbridgePublish = {
  op: "publish";
  topic: string;
  msg: RosMessage;
  id?: string;
  latch?: boolean;
};

export type RosbridgeSubscribe = {
  op: "subscribe";
  topic: string;
  type?: string;
  id?: string;
  throttle_rate?: number;
  queue_length?: number;
  compression?: "none" | "png" | "cbor" | "cbor-raw";
};

export function rosAdvertise(
  topic: RosTopicInput,
  type?: string,
  options: { id?: string; latch?: boolean; queueSize?: number } = {},
): RosbridgeAdvertise {
  const resolved = resolveRosTopic(topic, type);
  if (!resolved.type) throw new RuntimeContractError("MISSING_ROS_TYPE", "advertise에는 ROS 메시지 type이 필요합니다.");
  return {
    op: "advertise",
    topic: resolved.topic,
    type: resolved.type,
    ...(options.id ? { id: options.id } : {}),
    ...(options.latch === undefined ? {} : { latch: options.latch }),
    ...(options.queueSize === undefined ? {} : { queue_size: options.queueSize }),
  };
}

export function rosPublish(
  topic: RosTopicInput,
  msg: RosMessage,
  options: { id?: string; latch?: boolean } = {},
): RosbridgePublish {
  const resolved = resolveRosTopic(topic);
  return {
    op: "publish",
    topic: resolved.topic,
    msg,
    ...(options.id ? { id: options.id } : {}),
    ...(options.latch === undefined ? {} : { latch: options.latch }),
  };
}

export function rosSubscribe(
  topic: RosTopicInput,
  type?: string,
  options: {
    id?: string;
    throttleRate?: number;
    queueLength?: number;
    compression?: RosbridgeSubscribe["compression"];
  } = {},
): RosbridgeSubscribe {
  const resolved = resolveRosTopic(topic, type);
  return {
    op: "subscribe",
    topic: resolved.topic,
    ...(resolved.type ? { type: resolved.type } : {}),
    ...(options.id ? { id: options.id } : {}),
    ...(options.throttleRate === undefined ? {} : { throttle_rate: options.throttleRate }),
    ...(options.queueLength === undefined ? {} : { queue_length: options.queueLength }),
    ...(options.compression === undefined ? {} : { compression: options.compression }),
  };
}

export type RosTime = { sec: number; nanosec: number };

/** Convert Unix epoch milliseconds to the ROS 2 builtin_interfaces/Time shape. */
export function rosStamp(epochMs = Date.now()): RosTime {
  if (!Number.isFinite(epochMs)) throw new RangeError("epochMs must be finite");
  const sec = Math.floor(epochMs / 1_000);
  const nanosec = Math.floor((epochMs - sec * 1_000) * 1_000_000);
  return { sec, nanosec };
}

export function rosHeader(frameId: string, epochMs = Date.now()): { stamp: RosTime; frame_id: string } {
  return { stamp: rosStamp(epochMs), frame_id: frameId };
}

export function encodeRosbridgeMessage(message: RosbridgeAdvertise | RosbridgePublish | RosbridgeSubscribe): string {
  return JSON.stringify(message);
}

// Descriptive aliases for callers that prefer explicit rosbridge naming.
export const createRosbridgeAdvertise = rosAdvertise;
export const createRosbridgePublish = rosPublish;
export const createRosbridgeSubscribe = rosSubscribe;
