import { getD1 } from "@/db";
import { requireSiteUser } from "@/lib/auth";
import { policyCatalog, runServerSimulation } from "@/lib/simulation";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type SessionRow = {
  id: string;
  name: string;
  state: string;
  created_at: string;
  updated_at: string;
};

type ObjectRow = {
  id: string;
  object_type: string;
  state: string;
  version: number;
  payload_json: string;
  created_at: string;
  updated_at: string;
};

type RelationRow = {
  id: string;
  source_id: string;
  predicate: string;
  target_id: string;
  created_at: string;
};

type ActionRow = {
  id: string;
  action_name: string;
  actor_role: string;
  target_type: string;
  target_id: string;
  from_state: string | null;
  to_state: string;
  input_hash: string;
  details_json: string;
  created_at: string;
};

type RunRow = {
  id: string;
  scenario: string;
  days: number;
  policies_json: string;
  event_type: string | null;
  model_version: string;
  input_hash: string;
  result_json: string;
  created_at: string;
};

type JobRow = {
  id: string;
  production_run_object_id: string;
  intent: string;
  status: string;
  idempotency_key: string;
  request_json: string;
  receipt_json: string | null;
  created_at: string;
  updated_at: string;
};

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function textValue(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, `${label}을 입력하세요.`);
  return value.trim().slice(0, maxLength);
}

function numberValue(value: unknown, label: string, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new ApiError(400, `${label}은 ${minimum}–${maximum} 범위여야 합니다.`);
  }
  return parsed;
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
  return new Date().toISOString();
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return { parseError: true, raw: value };
  }
}

function actionStatement(
  db: D1Database,
  userId: string,
  sessionId: string,
  actionName: string,
  actorRole: string,
  targetType: string,
  targetId: string,
  fromState: string | null,
  toState: string,
  inputHash: string,
  details: unknown,
  createdAt: string,
) {
  return db.prepare(`INSERT INTO action_events
    (id, session_id, user_id, action_name, actor_role, target_type, target_id, from_state, to_state, input_hash, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id("act"), sessionId, userId, actionName, actorRole, targetType, targetId, fromState, toState, inputHash, JSON.stringify(details), createdAt);
}

async function assertSession(db: D1Database, userId: string, sessionId: string) {
  const session = await db.prepare("SELECT id, state FROM cf_sessions WHERE id = ? AND user_id = ?")
    .bind(sessionId, userId).first<{ id: string; state: string }>();
  if (!session) throw new ApiError(404, "실험 세션을 찾을 수 없습니다.");
  return session;
}

async function touchSession(db: D1Database, userId: string, sessionId: string, state: string, timestamp: string) {
  await db.prepare("UPDATE cf_sessions SET state = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(state, timestamp, sessionId, userId).run();
}

async function loadWorkspace(db: D1Database, userId: string, requestedSessionId?: string | null) {
  const sessionQuery = await db.prepare(`SELECT session.id, session.name, session.state,
      session.created_at, session.updated_at
    FROM cf_sessions session
    WHERE session.user_id = ? AND EXISTS (
      SELECT 1 FROM ontology_objects object
      WHERE object.user_id = session.user_id AND object.session_id = session.id
        AND object.object_type = 'EvidenceSession'
    )
    ORDER BY session.updated_at DESC`).bind(userId).all<SessionRow>();
  const sessions = sessionQuery.results ?? [];
  const activeSession = sessions.find((session) => session.id === requestedSessionId) ?? sessions[0] ?? null;

  const base = {
    persisted: true,
    model: "school-factory-core/1.0",
    policies: policyCatalog(),
    scenarios: [
      { value: "balanced", label: "균형 운영" },
      { value: "demand", label: "수요 충격" },
      { value: "skills", label: "역량 부족" },
    ],
    events: [
      { value: "", label: "추가 사건 없음" },
      { value: "demand", label: "수요 급증" },
      { value: "supply", label: "공급 지연" },
      { value: "machine", label: "설비 이상" },
      { value: "instructor", label: "교사 공백" },
    ],
    sessions,
    active: null,
  };

  if (!activeSession) return base;
  const sessionId = activeSession.id;
  const [objectsQuery, relationsQuery, actionsQuery, runsQuery, jobsQuery] = await Promise.all([
    db.prepare(`SELECT id, object_type, state, version, payload_json, created_at, updated_at
      FROM ontology_objects WHERE user_id = ? AND session_id = ? ORDER BY created_at ASC`).bind(userId, sessionId).all<ObjectRow>(),
    db.prepare(`SELECT id, source_id, predicate, target_id, created_at
      FROM ontology_relations WHERE user_id = ? AND session_id = ? ORDER BY created_at ASC`).bind(userId, sessionId).all<RelationRow>(),
    db.prepare(`SELECT id, action_name, actor_role, target_type, target_id, from_state, to_state, input_hash, details_json, created_at
      FROM action_events WHERE user_id = ? AND session_id = ? ORDER BY created_at DESC`).bind(userId, sessionId).all<ActionRow>(),
    db.prepare(`SELECT id, scenario, days, policies_json, event_type, model_version, input_hash, result_json, created_at
      FROM simulation_runs WHERE user_id = ? AND session_id = ? ORDER BY created_at DESC`).bind(userId, sessionId).all<RunRow>(),
    db.prepare(`SELECT id, production_run_object_id, intent, status, idempotency_key, request_json, receipt_json, created_at, updated_at
      FROM device_jobs WHERE user_id = ? AND session_id = ? ORDER BY created_at DESC`).bind(userId, sessionId).all<JobRow>(),
  ]);

  return {
    ...base,
    active: {
      session: activeSession,
      objects: (objectsQuery.results ?? []).map((row) => ({ ...row, payload: parseJson(row.payload_json), payload_json: undefined })),
      relations: relationsQuery.results ?? [],
      actions: (actionsQuery.results ?? []).map((row) => ({ ...row, details: parseJson(row.details_json), details_json: undefined })),
      runs: (runsQuery.results ?? []).map((row) => ({
        ...row,
        policies: parseJson(row.policies_json),
        result: parseJson(row.result_json),
        policies_json: undefined,
        result_json: undefined,
      })),
      jobs: (jobsQuery.results ?? []).map((row) => ({
        ...row,
        request: parseJson(row.request_json),
        receipt: parseJson(row.receipt_json),
        request_json: undefined,
        receipt_json: undefined,
      })),
    },
  };
}

async function createSession(db: D1Database, userId: string, payload: JsonRecord) {
  if (payload.consent !== true) throw new ApiError(400, "동의 범위를 확인해야 저장할 수 있습니다.");
  const name = textValue(payload.name, "세션 이름", 80);
  const testimony = textValue(payload.testimony, "증언", 1200);
  const distanceKm = numberValue(payload.distanceKm, "거리", 0, 500);
  const dwellMinutes = numberValue(payload.dwellMinutes, "체류 시간", 0, 1440);
  const timestamp = now();
  const sessionId = id("ses");
  const sessionObjectId = id("obj_session");
  const testimonyId = id("ev_testimony");
  const sensorId = id("ev_sensor");
  const hypothesisId = id("hyp");
  const input = { name, testimony, distanceKm, dwellMinutes, consent: true };
  const inputHash = await sha256(input);
  const hypothesis = dwellMinutes >= 5
    ? "장시간 머문 구간에는 기록 성과와 다른 경험 가치가 있을 수 있다."
    : "짧은 체류 구간의 의미는 추가 증언이 있어야 제품 가설로 사용할 수 있다.";
  const provenance = { source_system: "user_entry", source_hash_sha256: inputHash, generated_at: timestamp };

  await db.batch([
    db.prepare("INSERT INTO cf_sessions (id, user_id, name, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(sessionId, userId, name, "EVIDENCE_SAVED", timestamp, timestamp),
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`).bind(sessionObjectId, sessionId, userId, "EvidenceSession", "ACTIVE", JSON.stringify({ name }), timestamp, timestamp),
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`).bind(testimonyId, sessionId, userId, "EvidenceItem", "ACTIVE", JSON.stringify({ kind: "UTTERANCE", epistemic_class: "REPORTED", content_summary: testimony, sensitivity: "PRIVATE", provenance }), timestamp, timestamp),
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`).bind(sensorId, sessionId, userId, "EvidenceItem", "ACTIVE", JSON.stringify({ kind: "MOTION_SUMMARY", epistemic_class: "MEASURED", content_summary: `${distanceKm} km · 체류 ${dwellMinutes}분`, distance_km: distanceKm, dwell_minutes: dwellMinutes, sensitivity: "PRIVATE", provenance }), timestamp, timestamp),
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`).bind(hypothesisId, sessionId, userId, "Hypothesis", "PROPOSED", JSON.stringify({ statement: hypothesis, generator: "rule/template-v1", review_policy: "SINGLE_SUBJECT", required_confirmation_count: 1 }), timestamp, timestamp),
    db.prepare("INSERT INTO ontology_relations (id, session_id, user_id, source_id, predicate, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id("rel"), sessionId, userId, sessionObjectId, "CONTAINS", testimonyId, timestamp),
    db.prepare("INSERT INTO ontology_relations (id, session_id, user_id, source_id, predicate, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id("rel"), sessionId, userId, sessionObjectId, "CONTAINS", sensorId, timestamp),
    db.prepare("INSERT INTO ontology_relations (id, session_id, user_id, source_id, predicate, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id("rel"), sessionId, userId, testimonyId, "SUPPORTS", hypothesisId, timestamp),
    db.prepare("INSERT INTO ontology_relations (id, session_id, user_id, source_id, predicate, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id("rel"), sessionId, userId, sensorId, "SUPPORTS", hypothesisId, timestamp),
    actionStatement(db, userId, sessionId, "CreateEvidenceSession", "PARTICIPANT", "EvidenceSession", sessionObjectId, null, "ACTIVE", inputHash, { evidence_count: 2 }, timestamp),
    actionStatement(db, userId, sessionId, "ProposeHypothesis", "RULE_ENGINE", "Hypothesis", hypothesisId, "DRAFT", "PROPOSED", inputHash, { generator: "rule/template-v1" }, timestamp),
  ]);
  return sessionId;
}

async function reviewHypothesis(db: D1Database, userId: string, payload: JsonRecord) {
  const sessionId = textValue(payload.sessionId, "세션 ID", 120);
  await assertSession(db, userId, sessionId);
  const verdict = payload.verdict === "CONFIRMED" ? "CONFIRMED" : payload.verdict === "CONTESTED" ? "CONTESTED" : null;
  if (!verdict) throw new ApiError(400, "확인 또는 반박을 선택하세요.");
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 600) : "";
  const hypothesis = await db.prepare(`SELECT id, state FROM ontology_objects
    WHERE user_id = ? AND session_id = ? AND object_type = 'Hypothesis' ORDER BY created_at DESC LIMIT 1`)
    .bind(userId, sessionId).first<{ id: string; state: string }>();
  if (!hypothesis) throw new ApiError(409, "검토할 가설이 없습니다.");
  const timestamp = now();
  const reviewId = id("review");
  const inputHash = await sha256({ verdict, note, hypothesisId: hypothesis.id });
  await db.batch([
    db.prepare("UPDATE ontology_objects SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(verdict, timestamp, hypothesis.id, userId),
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, 'Review', ?, 1, ?, ?, ?)`).bind(reviewId, sessionId, userId, verdict, JSON.stringify({ verdict, note }), timestamp, timestamp),
    db.prepare("INSERT INTO ontology_relations (id, session_id, user_id, source_id, predicate, target_id, created_at) VALUES (?, ?, ?, ?, 'REVIEWS', ?, ?)")
      .bind(id("rel"), sessionId, userId, reviewId, hypothesis.id, timestamp),
    actionStatement(db, userId, sessionId, verdict === "CONFIRMED" ? "ConfirmHypothesis" : "ContestHypothesis", "PARTICIPANT", "Hypothesis", hypothesis.id, hypothesis.state, verdict, inputHash, { note }, timestamp),
  ]);
  await touchSession(db, userId, sessionId, verdict === "CONFIRMED" ? "READY_TO_SIMULATE" : "NEEDS_REVIEW", timestamp);
  return sessionId;
}

async function simulate(db: D1Database, userId: string, payload: JsonRecord) {
  const sessionId = textValue(payload.sessionId, "세션 ID", 120);
  await assertSession(db, userId, sessionId);
  const hypothesis = await db.prepare(`SELECT id, state FROM ontology_objects
    WHERE user_id = ? AND session_id = ? AND object_type = 'Hypothesis' ORDER BY created_at DESC LIMIT 1`)
    .bind(userId, sessionId).first<{ id: string; state: string }>();
  if (!hypothesis || hypothesis.state !== "CONFIRMED") throw new ApiError(409, "사람이 확인한 가설이 있어야 서버 시뮬레이션을 실행할 수 있습니다.");

  const scenario = payload.scenario === "demand" || payload.scenario === "skills" ? payload.scenario : "balanced";
  const days = Math.round(numberValue(payload.days, "기간", 30, 365));
  const policies = asObject(payload.policies) as Record<string, number>;
  const eventType = typeof payload.eventType === "string" && payload.eventType ? payload.eventType as "demand" | "supply" | "machine" | "instructor" : null;
  const result = runServerSimulation({ scenario, days, policies, eventType });
  const timestamp = now();
  const runId = id("sim");
  const productSpecId = id("spec");
  const planId = id("plan");
  const inputHash = await sha256(result.input);
  const planPayload = {
    quantity: Math.round(Number(result.summary?.operations?.goodUnits ?? 0)),
    material: "policy-and-training-capacity",
    due_at: new Date(Date.now() + days * 86400000).toISOString(),
    predicted_duration_seconds: days * 86400,
    predicted_material_cost: Number(result.summary?.finance?.factoryCost ?? 0),
    predicted_defect_rate: Number(result.summary?.operations?.weightedDefectRate ?? 0),
    simulation_model_version: result.modelVersion,
    simulation_input_hash_sha256: inputHash,
    simulation_run_id: runId,
  };

  await db.batch([
    db.prepare(`INSERT INTO simulation_runs
      (id, session_id, user_id, scenario, days, policies_json, event_type, model_version, input_hash, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(runId, sessionId, userId, scenario, days, JSON.stringify(policies), eventType, result.modelVersion, inputHash, JSON.stringify(result), timestamp),
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, 'ProductSpec', 'SELECTED', 1, ?, ?, ?)`).bind(productSpecId, sessionId, userId, JSON.stringify({ name: "학교–공장 운영 정책", description: "확인된 근거를 정책값으로 변환한 선택안", rationale_hypothesis_ids: [hypothesis.id], policies }), timestamp, timestamp),
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, 'ProductionPlan', 'SIMULATED', 1, ?, ?, ?)`).bind(planId, sessionId, userId, JSON.stringify(planPayload), timestamp, timestamp),
    db.prepare("INSERT INTO ontology_relations (id, session_id, user_id, source_id, predicate, target_id, created_at) VALUES (?, ?, ?, ?, 'JUSTIFIES', ?, ?)")
      .bind(id("rel"), sessionId, userId, hypothesis.id, productSpecId, timestamp),
    db.prepare("INSERT INTO ontology_relations (id, session_id, user_id, source_id, predicate, target_id, created_at) VALUES (?, ?, ?, ?, 'SIMULATED_AS', ?, ?)")
      .bind(id("rel"), sessionId, userId, productSpecId, planId, timestamp),
    actionStatement(db, userId, sessionId, "SimulateProductionPlan", "SERVER_MODEL", "ProductionPlan", planId, "DRAFT", "SIMULATED", inputHash, { run_id: runId, model_version: result.modelVersion }, timestamp),
  ]);
  await touchSession(db, userId, sessionId, "SIMULATED", timestamp);
  return sessionId;
}

async function createDeviceJob(db: D1Database, userId: string, payload: JsonRecord) {
  const sessionId = textValue(payload.sessionId, "세션 ID", 120);
  await assertSession(db, userId, sessionId);
  if (payload.intent !== "BEEP") throw new ApiError(400, "현재 허용된 장치 의도는 BEEP 하나뿐입니다.");
  const existing = await db.prepare(`SELECT id FROM device_jobs
    WHERE user_id = ? AND session_id = ? AND status IN ('REQUESTED','RECEIPT_PROCESSING') LIMIT 1`)
    .bind(userId, sessionId).first<{ id: string }>();
  if (existing) throw new ApiError(409, "아직 영수증이 없는 장치 작업이 있습니다.");
  const plan = await db.prepare(`SELECT id, state FROM ontology_objects
    WHERE user_id = ? AND session_id = ? AND object_type = 'ProductionPlan' AND state IN ('SIMULATED','APPROVED')
    ORDER BY created_at DESC LIMIT 1`).bind(userId, sessionId).first<{ id: string; state: string }>();
  if (!plan) throw new ApiError(409, "먼저 서버 시뮬레이션을 실행하세요.");

  const timestamp = now();
  const jobId = id("job");
  const productionRunId = id("run");
  const idempotencyKey = crypto.randomUUID();
  const request = {
    schema: "campfire.device-job.v1",
    job_id: jobId,
    production_run_id: productionRunId,
    idempotency_key: idempotencyKey,
    intent: "BEEP",
    issued_at: timestamp,
    safety: { raw_serial_allowed: false, joint_commands_allowed: false, receipt_required: true },
  };
  const inputHash = await sha256(request);

  await db.batch([
    db.prepare("UPDATE ontology_objects SET state = 'APPROVED', version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(timestamp, plan.id, userId),
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, 'ProductionRun', 'REQUESTED', 1, ?, ?, ?)`).bind(productionRunId, sessionId, userId, JSON.stringify(request), timestamp, timestamp),
    db.prepare(`INSERT INTO device_jobs
      (id, session_id, user_id, production_run_object_id, intent, status, idempotency_key, request_json, receipt_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'BEEP', 'REQUESTED', ?, ?, NULL, ?, ?)`).bind(jobId, sessionId, userId, productionRunId, idempotencyKey, JSON.stringify(request), timestamp, timestamp),
    db.prepare("INSERT INTO ontology_relations (id, session_id, user_id, source_id, predicate, target_id, created_at) VALUES (?, ?, ?, ?, 'EXECUTED_AS', ?, ?)")
      .bind(id("rel"), sessionId, userId, plan.id, productionRunId, timestamp),
    actionStatement(db, userId, sessionId, "ApproveProductionPlan", "OPERATOR", "ProductionRun", productionRunId, plan.state, "REQUESTED", inputHash, { intent: "BEEP", job_id: jobId }, timestamp),
  ]);
  await touchSession(db, userId, sessionId, "DEVICE_JOB_REQUESTED", timestamp);
  return sessionId;
}

async function applyDeviceReceipt(db: D1Database, userId: string, payload: JsonRecord) {
  const sessionId = textValue(payload.sessionId, "세션 ID", 120);
  await assertSession(db, userId, sessionId);
  const receipt = asObject(payload.receipt);
  const jobId = textValue(receipt.job_id, "영수증 job_id", 160);
  const idempotencyKey = textValue(receipt.idempotency_key, "영수증 idempotency_key", 160);
  const status = receipt.status === "SUCCEEDED" || receipt.status === "FAILED" || receipt.status === "ABORTED" ? receipt.status : null;
  if (!status) throw new ApiError(400, "영수증 상태는 SUCCEEDED, FAILED, ABORTED 중 하나여야 합니다.");
  const deviceId = textValue(receipt.device_id, "장치 ID", 160);
  const observedAt = textValue(receipt.observed_at, "관측 시각", 80);
  const observedTimestamp = Date.parse(observedAt);
  if (Number.isNaN(observedTimestamp) || new Date(observedTimestamp).toISOString() !== observedAt) {
    throw new ApiError(400, "관측 시각은 정규화된 ISO 날짜여야 합니다.");
  }

  const job = await db.prepare(`SELECT job.id, job.production_run_object_id, job.intent, job.status,
      job.idempotency_key, job.request_json, job.receipt_json, object.object_type
    FROM device_jobs job
    JOIN ontology_objects object ON object.id = job.production_run_object_id
      AND object.user_id = job.user_id AND object.session_id = job.session_id
    WHERE job.id = ? AND job.user_id = ? AND job.session_id = ?`).bind(jobId, userId, sessionId)
    .first<{
      id: string;
      production_run_object_id: string;
      intent: string;
      status: string;
      idempotency_key: string;
      request_json: string;
      receipt_json: string | null;
      object_type: string;
    }>();
  if (!job || job.idempotency_key !== idempotencyKey) throw new ApiError(409, "작업과 영수증의 멱등 키가 일치하지 않습니다.");
  const request = parseJson(job.request_json);
  if (
    job.intent !== "BEEP"
    || job.object_type !== "ProductionRun"
    || request.schema !== "campfire.device-job.v1"
    || request.intent !== "BEEP"
    || request.job_id !== jobId
    || request.idempotency_key !== idempotencyKey
  ) {
    throw new ApiError(409, "경영 시뮬레이션 BEEP 작업만 이 영수증 경로에서 처리할 수 있습니다.");
  }
  const issuedAt = typeof request.issued_at === "string" ? request.issued_at : "";
  const issuedTimestamp = Date.parse(issuedAt);
  if (Number.isNaN(issuedTimestamp) || new Date(issuedTimestamp).toISOString() !== issuedAt) {
    throw new ApiError(500, "저장된 작업 JSON의 발행 시각이 올바르지 않습니다.");
  }
  const allowedClockSkewMs = 5 * 60_000;
  if (observedTimestamp < issuedTimestamp - allowedClockSkewMs || observedTimestamp > Date.now() + allowedClockSkewMs) {
    throw new ApiError(409, "영수증 관찰 시각이 작업 발행 시각보다 지나치게 이르거나 현재보다 미래입니다.");
  }
  const receiptBase = {
    schema: "campfire.device-receipt.v1",
    job_id: jobId,
    idempotency_key: idempotencyKey,
    status,
    device_id: deviceId,
    observed_at: observedAt,
    verification_scope: "SCHEMA_AND_JOB_KEY_ONLY",
    physical_execution_verified: false,
  } as const;
  const inputHash = await sha256(receiptBase);
  const receiptPayload = { ...receiptBase, receipt_hash_sha256: inputHash };
  const storedReceiptMatches = (value: string | null | undefined) => {
    const stored = parseJson(value ?? null) as JsonRecord | null;
    return stored?.receipt_hash_sha256 === inputHash || Boolean(
      stored
      && stored.job_id === jobId
      && stored.idempotency_key === idempotencyKey
      && stored.status === status
      && stored.device_id === deviceId
      && stored.observed_at === observedAt,
    );
  };
  const terminalStatuses = [
    "USER_REPORTED_SUCCEEDED", "USER_REPORTED_FAILED", "USER_REPORTED_ABORTED",
    "SUCCEEDED", "FAILED", "ABORTED",
  ];
  if (terminalStatuses.includes(job.status)) {
    if (storedReceiptMatches(job.receipt_json)) return sessionId;
    throw new ApiError(409, "이미 다른 영수증으로 종료된 작업입니다.");
  }
  const claimedAt = now();
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const claimed = await db.prepare(`UPDATE device_jobs SET status = 'RECEIPT_PROCESSING', updated_at = ?
    WHERE id = ? AND user_id = ? AND session_id = ? AND intent = 'BEEP'
      AND (status = 'REQUESTED' OR (status = 'RECEIPT_PROCESSING' AND updated_at < ?))`)
    .bind(claimedAt, job.id, userId, sessionId, staleBefore).run();
  if ((claimed.meta.changes ?? 0) !== 1) {
    const current = await db.prepare("SELECT status, receipt_json FROM device_jobs WHERE id = ? AND user_id = ?")
      .bind(job.id, userId).first<{ status: string; receipt_json: string | null }>();
    if (current && terminalStatuses.includes(current.status) && storedReceiptMatches(current.receipt_json)) {
      return sessionId;
    }
    throw new ApiError(409, current?.status === "RECEIPT_PROCESSING" ? "다른 영수증을 처리 중입니다." : "이 작업은 새 영수증을 받을 수 없는 상태입니다.");
  }

  const timestamp = now();
  const receiptId = id("receipt");
  const outcomeId = id("outcome");
  const reportedStatus = `USER_REPORTED_${status}`;
  try {
    await db.batch([
    db.prepare("UPDATE device_jobs SET status = ?, receipt_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND intent = 'BEEP' AND status = 'RECEIPT_PROCESSING'")
      .bind(reportedStatus, JSON.stringify(receiptPayload), timestamp, job.id, userId),
    db.prepare("UPDATE ontology_objects SET state = ?, version = version + 1, payload_json = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(reportedStatus, JSON.stringify(receiptPayload), timestamp, job.production_run_object_id, userId),
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, 'DeviceReceipt', ?, 1, ?, ?, ?)`).bind(receiptId, sessionId, userId, reportedStatus, JSON.stringify(receiptPayload), timestamp, timestamp),
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, 'EvidenceItem', 'ACTIVE', 1, ?, ?, ?)`).bind(outcomeId, sessionId, userId, JSON.stringify({
        kind: "USER_REPORTED_DEVICE_RECEIPT",
        epistemic_class: "USER_REPORT",
        content_summary: `${deviceId} · 사용자 보고 ${status}`,
        source_reference: receiptId,
        observed_at: observedAt,
        verification_scope: receiptPayload.verification_scope,
        physical_execution_verified: false,
      }), timestamp, timestamp),
    db.prepare("INSERT INTO ontology_relations (id, session_id, user_id, source_id, predicate, target_id, created_at) VALUES (?, ?, ?, ?, 'HAS_RECEIPT', ?, ?)")
      .bind(id("rel"), sessionId, userId, job.production_run_object_id, receiptId, timestamp),
    db.prepare("INSERT INTO ontology_relations (id, session_id, user_id, source_id, predicate, target_id, created_at) VALUES (?, ?, ?, ?, 'PRODUCES', ?, ?)")
      .bind(id("rel"), sessionId, userId, job.production_run_object_id, outcomeId, timestamp),
    actionStatement(db, userId, sessionId, "ImportDeviceReceipt", "PARTICIPANT_IMPORT", "ProductionRun", job.production_run_object_id, "REQUESTED", reportedStatus, inputHash, {
      device_id: deviceId,
      observed_at: observedAt,
      verification: "schema_and_job_key_only",
      physical_execution_verified: false,
    }, timestamp),
    ]);
  } catch (cause) {
    await db.prepare(`UPDATE device_jobs SET status = 'REQUESTED', updated_at = ?
      WHERE id = ? AND user_id = ? AND intent = 'BEEP' AND status = 'RECEIPT_PROCESSING'`)
      .bind(now(), job.id, userId).run();
    throw cause;
  }
  await touchSession(db, userId, sessionId, status === "SUCCEEDED" ? "RECEIPT_RECORDED" : "FAILURE_REPORTED", timestamp);
  return sessionId;
}

export async function GET(request: Request) {
  try {
    const { userId } = requireSiteUser(request);
    const db = await getD1();
    const sessionId = new URL(request.url).searchParams.get("session");
    return Response.json(await loadWorkspace(db, userId, sessionId));
  } catch (error) {
    if (error instanceof Response) return error;
    const status = error instanceof ApiError ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message : "알 수 없는 오류" }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = requireSiteUser(request);
    const db = await getD1();
    const payload = asObject(await request.json());
    let sessionId: string;
    switch (payload.action) {
      case "create_session":
        sessionId = await createSession(db, userId, payload);
        break;
      case "review_hypothesis":
        sessionId = await reviewHypothesis(db, userId, payload);
        break;
      case "simulate":
        sessionId = await simulate(db, userId, payload);
        break;
      case "create_device_job":
        sessionId = await createDeviceJob(db, userId, payload);
        break;
      case "apply_device_receipt":
        sessionId = await applyDeviceReceipt(db, userId, payload);
        break;
      default:
        throw new ApiError(400, "지원하지 않는 작업입니다.");
    }
    return Response.json(await loadWorkspace(db, userId, sessionId));
  } catch (error) {
    if (error instanceof Response) return error;
    const status = error instanceof ApiError ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message : "알 수 없는 오류" }, { status });
  }
}
