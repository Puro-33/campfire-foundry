import { ensurePhysicalAiCatalog } from "@/db/catalog";
import { getD1 } from "@/db";
import { requireSiteUser } from "@/lib/auth";
import {
  PLANNER_VERSION,
  createPlan,
  getCapabilityDefinitions,
  isDeviceProfile,
  normalizeGoal,
  validatePlan,
  type CapabilityDefinition,
  type PhysicalAiPlan,
  type PlannerCandidate,
  type RuntimeCapabilities,
  type ValidationInput,
} from "@/lib/physical-ai-planner";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type CatalogNodeRow = {
  id: string;
  node_type: string;
  name: string;
  description: string;
  claimed_kind: string | null;
  canonical_url: string | null;
  verification_status: string;
  source_url: string;
  source_hash: string;
};

type CatalogRelationRow = {
  source_id: string;
  predicate: string;
  evidence_url: string;
  target_id: string;
  target_name: string;
  target_type: string;
  target_url: string | null;
};

type ObjectRow = {
  id: string;
  session_id: string;
  state: string;
  payload_json: string;
  created_at: string;
};

type DesignRow = ObjectRow & {
  session_name: string;
  session_state: string;
  updated_at: string;
};

type JobRow = {
  id: string;
  session_id: string;
  production_run_object_id: string;
  intent: string;
  status: string;
  idempotency_key: string;
  request_json: string;
  receipt_json: string | null;
  created_at: string;
  updated_at: string;
  object_type?: string;
};

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function textValue(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== "string") throw new ApiError(400, `${label}을 입력하세요.`);
  const text = value.trim();
  if (text.length < minimum) throw new ApiError(400, `${label}을 ${minimum}자 이상 입력하세요.`);
  if (text.length > maximum) throw new ApiError(400, `${label}은 ${maximum}자를 넘을 수 없습니다.`);
  return text;
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
  return new Date().toISOString();
}

function requestIdValue(value: unknown) {
  if (value === undefined) return id("request");
  const requestId = textValue(value, "요청 ID", 8, 180);
  if (!/^[a-zA-Z0-9_.:-]+$/.test(requestId)) throw new ApiError(400, "요청 ID 형식이 올바르지 않습니다.");
  return requestId;
}

async function withDesignLock<T>(
  db: D1Database,
  userId: string,
  designId: string,
  operation: () => Promise<T>,
) {
  const lockToken = crypto.randomUUID();
  const acquiredAt = now();
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const acquired = await db.prepare(`INSERT INTO physical_ai_operation_locks
      (user_id, design_id, lock_token, acquired_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, design_id) DO UPDATE SET
      lock_token = excluded.lock_token, acquired_at = excluded.acquired_at
    WHERE physical_ai_operation_locks.acquired_at < ?`)
    .bind(userId, designId, lockToken, acquiredAt, staleBefore).run();
  if ((acquired.meta.changes ?? 0) !== 1) throw new ApiError(409, "이 설계의 다른 작업이 처리 중입니다. 잠시 후 다시 시도하세요.");
  try {
    return await operation();
  } finally {
    await db.prepare(`DELETE FROM physical_ai_operation_locks
      WHERE user_id = ? AND design_id = ? AND lock_token = ?`).bind(userId, designId, lockToken).run().catch(() => undefined);
  }
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function actionStatement(
  db: D1Database,
  input: {
    userId: string;
    sessionId: string;
    actionName: string;
    actorRole: string;
    targetType: string;
    targetId: string;
    fromState: string | null;
    toState: string;
    inputHash: string;
    details: JsonRecord;
    timestamp: string;
  },
) {
  return db.prepare(`INSERT INTO action_events
    (id, session_id, user_id, action_name, actor_role, target_type, target_id,
     from_state, to_state, input_hash, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id("action"),
    input.sessionId,
    input.userId,
    input.actionName,
    input.actorRole,
    input.targetType,
    input.targetId,
    input.fromState,
    input.toState,
    input.inputHash,
    JSON.stringify(input.details),
    input.timestamp,
  );
}

function candidateScore(row: CatalogNodeRow, definition: CapabilityDefinition) {
  const name = row.name.toLocaleLowerCase("en-US");
  const accepted = definition.acceptedNames?.map((value) => value.toLocaleLowerCase("en-US")) ?? [];
  if (accepted.length > 0 && !accepted.some((value) => (
    name === value
    || name.endsWith(`/${value}`)
    || name.startsWith(`${value} `)
    || name.startsWith(`${value}-`)
    || name.startsWith(`${value} /`)
  ))) return 0;
  const description = row.description.toLocaleLowerCase("en-US");
  const kind = (row.claimed_kind ?? "").toLocaleLowerCase("en-US");
  let score = 0;
  for (const rawTerm of definition.terms) {
    const term = rawTerm.toLocaleLowerCase("en-US");
    if (name === term) score += 16;
    else if (name.includes(term)) score += 9;
    if (description.includes(term)) score += 3;
    if (kind.includes(term)) score += 2;
  }
  if (row.verification_status === "GITHUB_API_VERIFIED") score += 3;
  else if (row.verification_status.includes("LINKED")) score += 1;
  if (row.node_type === "Repository") score += 2;
  else if (row.node_type === "CatalogMention") score += 1;
  return score;
}

async function resolveCandidates(db: D1Database, definitions: CapabilityDefinition[]) {
  const catalogDefinitions = definitions.filter((definition) => definition.kind === "catalog" && definition.terms.length > 0);
  const terms = [...new Set(catalogDefinitions.flatMap((definition) => definition.terms.map((term) => term.toLocaleLowerCase("en-US"))))];
  const result: Record<string, PlannerCandidate[]> = Object.fromEntries(catalogDefinitions.map((definition) => [definition.id, []]));
  if (terms.length === 0) return result;

  const termConditions = terms.map(() => "(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(COALESCE(claimed_kind, '')) LIKE ?)").join(" OR ");
  const bindings = terms.flatMap((term) => [`%${term}%`, `%${term}%`, `%${term}%`]);
  const rows = await db.prepare(`SELECT id, node_type, name, description, claimed_kind, canonical_url,
      verification_status, source_url, source_hash
    FROM physical_ai_nodes
    WHERE node_type IN ('CatalogMention', 'Repository', 'WebResource', 'Organization')
      AND (${termConditions})
    ORDER BY CASE verification_status WHEN 'GITHUB_API_VERIFIED' THEN 0 WHEN 'INDEX_LINKED' THEN 1 ELSE 2 END,
      name COLLATE NOCASE
    LIMIT 240`).bind(...bindings).all<CatalogNodeRow>();

  for (const definition of catalogDefinitions) {
    const seen = new Set<string>();
    result[definition.id] = (rows.results ?? [])
      .map((row) => ({ row, score: candidateScore(row, definition) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
      .filter(({ row }) => {
        const key = row.name.toLocaleLowerCase("en-US");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3)
      .map(({ row, score }) => ({
        catalogNodeId: row.id,
        name: row.name,
        nodeType: row.node_type,
        description: row.description,
        verificationStatus: row.verification_status,
        resourceUrl: row.canonical_url,
        evidenceUrl: row.source_url,
        sourceHash: row.source_hash,
        score,
        evidenceScope: "CATALOG_PROVENANCE_ONLY" as const,
        links: [],
      }));
  }

  const selectedIds = [...new Set(Object.values(result).flatMap((candidates) => candidates.map((candidate) => candidate.catalogNodeId)))];
  if (selectedIds.length === 0) return result;
  const placeholders = selectedIds.map(() => "?").join(", ");
  const relations = await db.prepare(`SELECT r.source_id, r.predicate, r.evidence_url,
      target.id AS target_id, target.name AS target_name, target.node_type AS target_type,
      target.canonical_url AS target_url
    FROM physical_ai_relations r
    JOIN physical_ai_nodes target ON target.id = r.target_id
    WHERE r.source_id IN (${placeholders})
      AND r.predicate IN ('HAS_CODE', 'HAS_PAPER', 'HAS_PROJECT_PAGE', 'HAS_DATASET')
    ORDER BY r.predicate, target.name COLLATE NOCASE
    LIMIT 160`).bind(...selectedIds).all<CatalogRelationRow>();
  const linksBySource = new Map<string, CatalogRelationRow[]>();
  for (const relation of relations.results ?? []) {
    const list = linksBySource.get(relation.source_id) ?? [];
    if (list.length < 3) list.push(relation);
    linksBySource.set(relation.source_id, list);
  }
  for (const candidates of Object.values(result)) {
    for (const candidate of candidates) {
      const links = linksBySource.get(candidate.catalogNodeId) ?? [];
      candidate.links = links.map((relation) => ({
        predicate: relation.predicate,
        targetId: relation.target_id,
        targetName: relation.target_name,
        targetType: relation.target_type,
        targetUrl: relation.target_url,
        evidenceUrl: relation.evidence_url,
      }));
      candidate.resourceUrl ??= links.find((link) => link.target_url)?.target_url ?? null;
    }
  }
  return result;
}

async function findDesign(db: D1Database, userId: string, designId: string) {
  const row = await db.prepare(`SELECT object.id, object.session_id, object.state, object.payload_json,
      object.created_at, session.name AS session_name, session.state AS session_state,
      session.updated_at
    FROM ontology_objects object
    JOIN cf_sessions session ON session.id = object.session_id AND session.user_id = object.user_id
    WHERE object.id = ? AND object.user_id = ? AND object.object_type = 'DesignPlan'`)
    .bind(designId, userId).first<DesignRow>();
  if (!row) throw new ApiError(404, "설계안을 찾을 수 없습니다.");
  const plan = parseJson<PhysicalAiPlan>(row.payload_json);
  if (!plan) throw new ApiError(500, "저장된 설계안을 읽을 수 없습니다.");
  return { row, plan };
}

async function loadDesigner(db: D1Database, userId: string, requestedSessionId?: string | null) {
  const historyQuery = await db.prepare(`SELECT object.id, object.session_id, object.state, object.payload_json,
      object.created_at, session.name AS session_name, session.state AS session_state,
      session.updated_at
    FROM ontology_objects object
    JOIN cf_sessions session ON session.id = object.session_id AND session.user_id = object.user_id
    WHERE object.user_id = ? AND object.object_type = 'DesignPlan'
    ORDER BY session.updated_at DESC LIMIT 12`).bind(userId).all<DesignRow>();
  const history = (historyQuery.results ?? []).flatMap((row) => {
    const plan = parseJson<PhysicalAiPlan>(row.payload_json);
    if (!plan) return [];
    return [{
      sessionId: row.session_id,
      designId: row.id,
      title: plan.scenario.title,
      goal: plan.goal,
      state: row.state,
      updatedAt: row.updated_at,
    }];
  });
  const selectedSessionId = requestedSessionId && history.some((item) => item.sessionId === requestedSessionId)
    ? requestedSessionId
    : history[0]?.sessionId;
  if (!selectedSessionId) return { history, active: null };

  const [objectsQuery, job] = await Promise.all([
    db.prepare(`SELECT id, session_id, state, payload_json, created_at
      FROM ontology_objects WHERE user_id = ? AND session_id = ?
      AND object_type IN ('DesignPlan', 'ValidationRun', 'DeviceJobManifest', 'ProductionRun', 'DeviceReceipt')
      ORDER BY created_at ASC`).bind(userId, selectedSessionId).all<ObjectRow>(),
    db.prepare(`SELECT id, session_id, production_run_object_id, intent, status, idempotency_key,
      request_json, receipt_json, created_at, updated_at
      FROM device_jobs WHERE user_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(userId, selectedSessionId).first<JobRow>(),
  ]);
  const objects = objectsQuery.results ?? [];
  const designRow = objects.findLast((object) => parseJson<JsonRecord>(object.payload_json)?.schema === "campfire.physical-ai-design.v1");
  if (!designRow) return { history, active: null };
  const validationRow = objects.findLast((object) => parseJson<JsonRecord>(object.payload_json)?.schema === "campfire.physical-ai-validation.v1");
  const receiptRow = objects.findLast((object) => {
    const schema = parseJson<JsonRecord>(object.payload_json)?.schema;
    return schema === "campfire.device-receipt.v1" || schema === "campfire.device-receipt.v2";
  });
  return {
    history,
    active: {
      sessionId: selectedSessionId,
      state: history.find((item) => item.sessionId === selectedSessionId)?.state ?? designRow.state,
      plan: parseJson<PhysicalAiPlan>(designRow.payload_json),
      validation: validationRow ? parseJson<JsonRecord>(validationRow.payload_json) : null,
      job: job ? {
        id: job.id,
        status: job.status,
        intent: job.intent,
        idempotencyKey: job.idempotency_key,
        request: parseJson<JsonRecord>(job.request_json),
        receipt: parseJson<JsonRecord>(job.receipt_json),
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      } : null,
      receipt: receiptRow ? parseJson<JsonRecord>(receiptRow.payload_json) : null,
    },
  };
}

async function createDesign(db: D1Database, userId: string, payload: JsonRecord) {
  const requestId = requestIdValue(payload.requestId);
  const goal = textValue(payload.goal, "목표", 8, 600);
  const successMetric = textValue(payload.successMetric, "성공 조건", 3, 240);
  if (!isDeviceProfile(payload.deviceProfile)) throw new ApiError(400, "지원하는 장치 구성을 선택하세요.");
  const allowedConstraints = new Set(["privacy_first", "offline_preferred", "low_budget", "human_approval"]);
  const constraints = Array.isArray(payload.constraints)
    ? [...new Set(payload.constraints.filter((value): value is string => typeof value === "string" && allowedConstraints.has(value)))].slice(0, 4)
    : [];
  await ensurePhysicalAiCatalog(db);
  const meta = await db.prepare("SELECT source_hash FROM physical_ai_catalog_meta WHERE id = 'current'")
    .first<{ source_hash: string }>();
  if (!meta) throw new ApiError(503, "온톨로지 스냅샷이 준비되지 않았습니다.");

  const definitions = getCapabilityDefinitions(goal);
  const candidates = await resolveCandidates(db, definitions);
  const timestamp = now();
  const designHash = await sha256({
    goal: normalizeGoal(goal),
    successMetric,
    deviceProfile: payload.deviceProfile,
    constraints: [...constraints].sort(),
    catalogSnapshotHash: meta.source_hash,
    plannerVersion: PLANNER_VERSION,
    candidateIds: Object.fromEntries(Object.entries(candidates).sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, values.map((value) => value.catalogNodeId).sort()])),
  });
  const submitted = await db.prepare(`SELECT session_id, design_hash FROM physical_ai_design_submissions
    WHERE user_id = ? AND request_id = ? LIMIT 1`).bind(userId, requestId).first<{ session_id: string; design_hash: string }>();
  if (submitted) {
    if (submitted.design_hash !== designHash) throw new ApiError(409, "같은 요청 ID를 다른 설계 입력에 재사용할 수 없습니다.");
    return submitted.session_id;
  }
  const sessionId = id("session");
  const goalId = id("goal");
  const designId = id("design");
  const plan = createPlan({
    id: designId,
    sessionId,
    designHash,
    goal,
    successMetric,
    constraints,
    deviceProfile: payload.deviceProfile,
    catalogSnapshotHash: meta.source_hash,
    candidates,
    createdAt: timestamp,
  });

  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO physical_ai_design_submissions
      (user_id, request_id, design_hash, session_id, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(userId, requestId, designHash, sessionId, timestamp),
    db.prepare("INSERT INTO cf_sessions (id, user_id, name, state, created_at, updated_at) VALUES (?, ?, ?, 'DESIGN_DRAFT', ?, ?)")
      .bind(sessionId, userId, plan.scenario.title, timestamp, timestamp),
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, 'Goal', 'DEFINED', 1, ?, ?, ?)`).bind(goalId, sessionId, userId, JSON.stringify({
        schema: "campfire.goal.v1", statement: goal, success_metric: successMetric, constraints,
      }), timestamp, timestamp),
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, 'DesignPlan', 'DRAFT', 1, ?, ?, ?)`).bind(designId, sessionId, userId, JSON.stringify(plan), timestamp, timestamp),
    db.prepare(`INSERT INTO ontology_relations
      (id, session_id, user_id, source_id, predicate, target_id, created_at)
      VALUES (?, ?, ?, ?, 'INFORMS', ?, ?)`).bind(id("rel"), sessionId, userId, goalId, designId, timestamp),
  ];

  for (const capability of plan.capabilities) {
    const requirementId = id("requirement");
    statements.push(
      db.prepare(`INSERT INTO ontology_objects
        (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, 'CapabilityRequirement', ?, 1, ?, ?, ?)`).bind(
        requirementId,
        sessionId,
        userId,
        capability.status,
        JSON.stringify({
          schema: "campfire.capability-requirement.v1",
          capability_id: capability.id,
          label: capability.label,
          kind: capability.kind,
          phase: capability.phase,
          ontology_role_id: capability.phase === "sense" ? "role:sensing"
            : capability.phase === "interpret" ? "role:reasoning"
              : capability.phase === "decide" ? "role:policy"
                : capability.phase === "act" ? "role:execution"
                  : "role:control",
          status: capability.status,
        }),
        timestamp,
        timestamp,
      ),
      db.prepare(`INSERT INTO ontology_relations
        (id, session_id, user_id, source_id, predicate, target_id, created_at)
        VALUES (?, ?, ?, ?, 'REQUIRES', ?, ?)`).bind(id("rel"), sessionId, userId, designId, requirementId, timestamp),
    );
    for (const candidate of capability.candidates) {
      const selectionId = id("selection");
      statements.push(
        db.prepare(`INSERT INTO ontology_objects
          (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
          VALUES (?, ?, ?, 'CatalogSelection', 'PROPOSED', 1, ?, ?, ?)`).bind(selectionId, sessionId, userId, JSON.stringify({
            schema: "campfire.catalog-selection.v1",
            capability_id: capability.id,
            catalog_node_id: candidate.catalogNodeId,
            name: candidate.name,
            node_type: candidate.nodeType,
            resource_url: candidate.resourceUrl,
            evidence_url: candidate.evidenceUrl,
            source_hash: candidate.sourceHash,
            evidence_scope: candidate.evidenceScope,
            catalog_snapshot_hash: meta.source_hash,
          }), timestamp, timestamp),
        db.prepare(`INSERT INTO ontology_relations
          (id, session_id, user_id, source_id, predicate, target_id, created_at)
          VALUES (?, ?, ?, ?, 'HAS_CANDIDATE', ?, ?)`).bind(id("rel"), sessionId, userId, requirementId, selectionId, timestamp),
      );
    }
  }
  statements.push(
    actionStatement(db, {
      userId, sessionId, actionName: "DefineGoal", actorRole: "PARTICIPANT", targetType: "Goal",
      targetId: goalId, fromState: null, toState: "DEFINED", inputHash: designHash,
      details: { success_metric: successMetric }, timestamp,
    }),
    actionStatement(db, {
      userId, sessionId, actionName: "GeneratePhysicalAiDesign", actorRole: "RULE_ENGINE", targetType: "DesignPlan",
      targetId: designId, fromState: null, toState: "DRAFT", inputHash: designHash,
      details: { planner_version: PLANNER_VERSION, catalog_snapshot_hash: meta.source_hash }, timestamp,
    }),
  );
  try {
    await db.batch(statements);
  } catch (cause) {
    const request = await db.prepare(`SELECT session_id, design_hash FROM physical_ai_design_submissions
      WHERE user_id = ? AND request_id = ? LIMIT 1`).bind(userId, requestId).first<{ session_id: string; design_hash: string }>();
    if (request) {
      if (request.design_hash !== designHash) throw new ApiError(409, "같은 요청 ID를 다른 설계 입력에 재사용할 수 없습니다.");
      return request.session_id;
    }
    throw cause;
  }
  return sessionId;
}

function validationInput(payload: JsonRecord): ValidationInput {
  const runtimeRecord = asRecord(payload.runtime);
  const selectionRecord = asRecord(payload.selectedResources);
  const selectedResources = Object.fromEntries(
    Object.entries(selectionRecord)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .slice(0, 40),
  );
  const runtime: RuntimeCapabilities = {
    cameraApi: runtimeRecord.cameraApi === true,
    microphoneApi: runtimeRecord.microphoneApi === true,
    motionApi: runtimeRecord.motionApi === true,
    geolocationApi: runtimeRecord.geolocationApi === true,
    clockApi: runtimeRecord.clockApi === true,
    serialApi: runtimeRecord.serialApi === true,
  };
  return {
    selectedResources,
    runtime,
    deviceConfirmed: payload.deviceConfirmed === true,
    softwareReady: payload.softwareReady === true,
    externalReady: payload.externalReady === true,
    consentConfirmed: payload.consentConfirmed === true,
    safetyConfirmed: payload.safetyConfirmed === true,
  };
}

async function validateDesign(db: D1Database, userId: string, payload: JsonRecord) {
  const designId = textValue(payload.designId, "설계 ID", 5, 180);
  const requestId = requestIdValue(payload.requestId);
  return withDesignLock(db, userId, designId, async () => {
  const { row, plan } = await findDesign(db, userId, designId);
  const input = validationInput(payload);
  const catalogCapabilities = new Map(
    plan.capabilities
      .filter((capability) => capability.kind === "catalog")
      .map((capability) => [capability.id, new Set(capability.candidates.map((candidate) => candidate.catalogNodeId))]),
  );
  if (Object.entries(input.selectedResources).some(([capabilityId, resourceId]) => !catalogCapabilities.get(capabilityId)?.has(resourceId))) {
    throw new ApiError(400, "현재 설계안에 없는 온톨로지 근거가 포함됐습니다.");
  }
  const inputHash = await sha256({ planHash: plan.designHash, input });
  const submitted = await db.prepare(`SELECT session_id, design_id, input_hash FROM physical_ai_validation_submissions
    WHERE user_id = ? AND request_id = ? LIMIT 1`).bind(userId, requestId)
    .first<{ session_id: string; design_id: string; input_hash: string }>();
  if (submitted) {
    if (submitted.design_id !== designId || submitted.input_hash !== inputHash) {
      throw new ApiError(409, "같은 요청 ID를 다른 확인 입력에 재사용할 수 없습니다.");
    }
    return submitted.session_id;
  }
  if (!["DRAFT", "BLOCKED", "MANIFEST_READY"].includes(row.state)) {
    throw new ApiError(409, "작업 JSON을 만든 뒤에는 이 설계를 다시 확인 상태로 되돌릴 수 없습니다.");
  }
  const validation = validatePlan(plan, input);
  const timestamp = now();
  const validationId = id("validation");
  const validationPayload = {
    schema: "campfire.physical-ai-validation.v1",
    id: validationId,
    design_id: designId,
    input_hash_sha256: inputHash,
    input_snapshot: input,
    created_at: timestamp,
    ...validation,
  };
  const nextState = validation.status === "ATTESTED" ? "MANIFEST_READY" : "BLOCKED";
  const [selectionRows, requirementRows] = await Promise.all([
    db.prepare(`SELECT id, session_id, state, payload_json, created_at
      FROM ontology_objects WHERE user_id = ? AND session_id = ? AND object_type = 'CatalogSelection'`)
      .bind(userId, row.session_id).all<ObjectRow>(),
    db.prepare(`SELECT id, session_id, state, payload_json, created_at
      FROM ontology_objects WHERE user_id = ? AND session_id = ? AND object_type = 'CapabilityRequirement'`)
      .bind(userId, row.session_id).all<ObjectRow>(),
  ]);
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO physical_ai_validation_submissions
      (user_id, request_id, design_id, input_hash, session_id, validation_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(userId, requestId, designId, inputHash, row.session_id, validationId, timestamp),
    db.prepare("UPDATE ontology_objects SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND state IN ('DRAFT', 'BLOCKED', 'MANIFEST_READY')")
      .bind(nextState, timestamp, designId, userId),
    db.prepare("UPDATE cf_sessions SET state = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(nextState, timestamp, row.session_id, userId),
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, 'ValidationRun', ?, 1, ?, ?, ?)`).bind(
      validationId, row.session_id, userId, validation.status, JSON.stringify(validationPayload), timestamp, timestamp,
    ),
    db.prepare(`INSERT INTO ontology_relations
      (id, session_id, user_id, source_id, predicate, target_id, created_at)
      VALUES (?, ?, ?, ?, 'VALIDATED_AS', ?, ?)`).bind(id("rel"), row.session_id, userId, designId, validationId, timestamp),
    actionStatement(db, {
      userId, sessionId: row.session_id, actionName: "RecordPhysicalAiPreflight", actorRole: "PARTICIPANT_ATTESTATION",
      targetType: "DesignPlan", targetId: designId, fromState: row.state, toState: nextState,
      inputHash, details: {
        check_coverage: validation.checkCoverage,
        check_count: validation.checks.length,
        methods: [...new Set(validation.checks.map((check) => check.method))],
        physical_execution_verified: false,
      }, timestamp,
    }),
  ];
  for (const selection of selectionRows.results ?? []) {
    const selectionPayload = parseJson<{ capability_id?: string; catalog_node_id?: string }>(selection.payload_json);
    const adopted = Boolean(
      selectionPayload?.capability_id
      && selectionPayload.catalog_node_id
      && input.selectedResources[selectionPayload.capability_id] === selectionPayload.catalog_node_id,
    );
    statements.push(
      db.prepare("UPDATE ontology_objects SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(adopted ? "USER_SELECTED_REFERENCE" : "PROPOSED", timestamp, selection.id, userId),
    );
  }
  const assessments = new Map(validation.capabilityAssessments.map((assessment) => [assessment.capabilityId, assessment]));
  for (const requirement of requirementRows.results ?? []) {
    const requirementPayload = parseJson<JsonRecord>(requirement.payload_json) ?? {};
    const capabilityId = typeof requirementPayload.capability_id === "string" ? requirementPayload.capability_id : "";
    const assessment = assessments.get(capabilityId);
    if (!assessment) continue;
    statements.push(
      db.prepare("UPDATE ontology_objects SET state = ?, version = version + 1, payload_json = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(assessment.state, JSON.stringify({
          ...requirementPayload,
          status: assessment.state,
          assessment_method: assessment.method,
          assessment_detail: assessment.detail,
          validation_id: validationId,
        }), timestamp, requirement.id, userId),
      db.prepare(`INSERT INTO ontology_relations
        (id, session_id, user_id, source_id, predicate, target_id, created_at)
        VALUES (?, ?, ?, ?, 'EVALUATES', ?, ?)`).bind(
        id("rel"), row.session_id, userId, validationId, requirement.id, timestamp,
      ),
    );
  }
  try {
    await db.batch(statements);
  } catch (cause) {
    const request = await db.prepare(`SELECT session_id, design_id, input_hash FROM physical_ai_validation_submissions
      WHERE user_id = ? AND request_id = ? LIMIT 1`)
      .bind(userId, requestId).first<{ session_id: string; design_id: string; input_hash: string }>();
    if (request) {
      if (request.design_id !== designId || request.input_hash !== inputHash) {
        throw new ApiError(409, "같은 요청 ID를 다른 확인 입력에 재사용할 수 없습니다.");
      }
      return request.session_id;
    }
    throw cause;
  }
  return row.session_id;
  });
}

async function issueDeviceJob(db: D1Database, userId: string, payload: JsonRecord) {
  const designId = textValue(payload.designId, "설계 ID", 5, 180);
  return withDesignLock(db, userId, designId, async () => {
  const { row, plan } = await findDesign(db, userId, designId);
  if (row.state !== "MANIFEST_READY") throw new ApiError(409, "확인 항목을 기록한 설계만 장치 작업 JSON을 만들 수 있습니다.");
  const validationRow = await db.prepare(`SELECT id, session_id, state, payload_json, created_at
    FROM ontology_objects WHERE user_id = ? AND session_id = ? AND object_type = 'ValidationRun'
      AND json_extract(payload_json, '$.design_id') = ?
    ORDER BY created_at DESC LIMIT 1`).bind(userId, row.session_id, designId).first<ObjectRow>();
  const validation = validationRow ? parseJson<JsonRecord>(validationRow.payload_json) : null;
  if (!validationRow || validationRow.state !== "ATTESTED" || !validation) throw new ApiError(409, "현재 설계에 대한 확인 기록이 없습니다.");
  const existing = await db.prepare(`SELECT id FROM device_jobs
    WHERE user_id = ? AND session_id = ? AND status IN ('REQUESTED', 'RECEIPT_PROCESSING') LIMIT 1`)
    .bind(userId, row.session_id).first<{ id: string }>();
  if (existing) throw new ApiError(409, "이미 만든 작업 JSON에 대한 영수증 기록이 남아 있습니다.");

  const timestamp = now();
  const jobId = id("job");
  const manifestId = id("manifest");
  const idempotencyKey = crypto.randomUUID();
  const requestBase = {
    schema: "campfire.device-job.v3",
    job_id: jobId,
    manifest_id: manifestId,
    design_id: designId,
    design_hash_sha256: plan.designHash,
    validation_id: validationRow.id,
    idempotency_key: idempotencyKey,
    intent: "SUBMIT_EXPERIMENT_MANIFEST",
    issued_at: timestamp,
    delivery_status: "NOT_SENT",
    execution_authority: "BROWSER_OR_EXTERNAL_ADAPTER_REQUIRED",
    physical_execution_verified_by_site: false,
    device_profile: plan.device.id,
    goal: plan.goal,
    experiment: validation.manifest,
    receipt_contract: {
      schema: "campfire.device-receipt.v2",
      required_fields: [
        "schema",
        "job_id", "idempotency_key", "request_hash_sha256", "design_hash_sha256",
        "status", "device_id", "observed_at", "evidence_hash_sha256", "attempt_id",
        "execution_mode", "reason_code", "terminal_step", "metrics", "artifact",
        "physical_execution_verified",
      ],
      accepted_statuses: ["SUCCEEDED", "FAILED", "ABORTED"],
      copy_from_request: ["job_id", "idempotency_key", "design_hash_sha256"],
      request_hash_source: "top_level.request_hash_sha256",
      evidence_hash_format: "lowercase_sha256_hex",
      verification_scope: "SERVER_JOB_KEYS_AND_HASH_FORMAT_PLUS_CLIENT_HASHED_LOCAL_ARTIFACT_CLAIM",
      physical_execution_verified_by_site: false,
    },
    safety: {
      raw_serial_allowed: false,
      joint_commands_allowed: false,
      physical_hardware_allowed_by_smartphone_runtime: false,
      person_following_mode: "ROS2_SIMULATION_ONLY",
      human_approval_required: true,
      receipt_required: true,
    },
  };
  const requestHash = await sha256(requestBase);
  const request = { ...requestBase, request_hash_sha256: requestHash };
  try {
    await db.batch([
    db.prepare(`INSERT INTO ontology_objects
      (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, 'DeviceJobManifest', 'AWAITING_ADAPTER', 1, ?, ?, ?)`).bind(
      manifestId, row.session_id, userId, JSON.stringify(request), timestamp, timestamp,
    ),
    db.prepare(`INSERT INTO device_jobs
      (id, session_id, user_id, production_run_object_id, intent, status, idempotency_key,
       request_json, receipt_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'SUBMIT_EXPERIMENT_MANIFEST', 'REQUESTED', ?, ?, NULL, ?, ?)`).bind(
      jobId, row.session_id, userId, manifestId, idempotencyKey, JSON.stringify(request), timestamp, timestamp,
    ),
    db.prepare("UPDATE ontology_objects SET state = 'JOB_MANIFEST_CREATED', version = version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND state = 'MANIFEST_READY'")
      .bind(timestamp, designId, userId),
    db.prepare("UPDATE cf_sessions SET state = 'JOB_MANIFEST_CREATED', updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(timestamp, row.session_id, userId),
    db.prepare(`INSERT INTO ontology_relations
      (id, session_id, user_id, source_id, predicate, target_id, created_at)
      VALUES (?, ?, ?, ?, 'PREPARED_AS', ?, ?)`).bind(id("rel"), row.session_id, userId, designId, manifestId, timestamp),
    actionStatement(db, {
      userId, sessionId: row.session_id, actionName: "PreparePhysicalAiDeviceJob", actorRole: "OPERATOR",
      targetType: "DeviceJobManifest", targetId: manifestId, fromState: null, toState: "AWAITING_ADAPTER",
      inputHash: requestHash, details: {
        job_id: jobId,
        delivery_status: "NOT_SENT",
        external_adapter_required: true,
        physical_execution_verified: false,
      }, timestamp,
    }),
    ]);
  } catch {
    const concurrentlyCreated = await db.prepare(`SELECT id FROM device_jobs
      WHERE user_id = ? AND session_id = ? AND status IN ('REQUESTED', 'RECEIPT_PROCESSING') LIMIT 1`)
      .bind(userId, row.session_id).first<{ id: string }>();
    if (concurrentlyCreated) throw new ApiError(409, "이미 만든 작업 JSON에 대한 영수증 기록이 남아 있습니다.");
    throw new ApiError(500, "작업 JSON을 저장하지 못했습니다.");
  }
  return row.session_id;
  });
}

async function applyDeviceReceipt(db: D1Database, userId: string, payload: JsonRecord) {
  const designId = textValue(payload.designId, "설계 ID", 5, 180);
  const { row, plan } = await findDesign(db, userId, designId);
  const receipt = asRecord(payload.receipt);
  const jobId = textValue(receipt.job_id, "영수증 job_id", 5, 180);
  const idempotencyKey = textValue(receipt.idempotency_key, "영수증 idempotency_key", 5, 180);
  const status = receipt.status === "SUCCEEDED" || receipt.status === "FAILED" || receipt.status === "ABORTED"
    ? receipt.status
    : null;
  if (!status) throw new ApiError(400, "영수증 상태는 SUCCEEDED, FAILED, ABORTED 중 하나여야 합니다.");
  const deviceId = textValue(receipt.device_id, "장치 ID", 2, 160);
  const observedAt = textValue(receipt.observed_at, "관찰 시각", 10, 80);
  const observedTimestamp = Date.parse(observedAt);
  if (Number.isNaN(observedTimestamp) || new Date(observedTimestamp).toISOString() !== observedAt) {
    throw new ApiError(400, "관찰 시각은 정규화된 ISO 날짜여야 합니다.");
  }
  const evidenceHash = textValue(receipt.evidence_hash_sha256, "증거 SHA-256", 64, 64).toLocaleLowerCase("en-US");
  if (!/^[a-f0-9]{64}$/.test(evidenceHash)) throw new ApiError(400, "증거 SHA-256은 64자리 16진수여야 합니다.");
  const submittedRequestHash = textValue(receipt.request_hash_sha256, "요청 SHA-256", 64, 64).toLocaleLowerCase("en-US");
  const submittedDesignHash = textValue(receipt.design_hash_sha256, "설계 SHA-256", 64, 64).toLocaleLowerCase("en-US");
  if (!/^[a-f0-9]{64}$/.test(submittedRequestHash) || !/^[a-f0-9]{64}$/.test(submittedDesignHash)) {
    throw new ApiError(400, "요청·설계 SHA-256은 각각 64자리 16진수여야 합니다.");
  }
  if (JSON.stringify(receipt).length > 20_000) throw new ApiError(400, "영수증이 너무 큽니다.");

  const job = await db.prepare(`SELECT job.id, job.session_id, job.production_run_object_id, job.intent, job.status,
      job.idempotency_key, job.request_json, job.receipt_json, job.created_at, job.updated_at, object.object_type
    FROM device_jobs job
    JOIN ontology_objects object ON object.id = job.production_run_object_id
      AND object.user_id = job.user_id AND object.session_id = job.session_id
    WHERE job.id = ? AND job.user_id = ? AND job.session_id = ?`)
    .bind(jobId, userId, row.session_id).first<JobRow>();
  if (!job || job.idempotency_key !== idempotencyKey) throw new ApiError(409, "작업과 영수증의 멱등 키가 일치하지 않습니다.");
  const request = parseJson<JsonRecord>(job.request_json);
  if (!request) throw new ApiError(500, "저장된 작업 JSON을 읽을 수 없습니다.");
  if (
    job.intent !== "SUBMIT_EXPERIMENT_MANIFEST"
    || job.object_type !== "DeviceJobManifest"
    || (request.schema !== "campfire.device-job.v2" && request.schema !== "campfire.device-job.v3")
    || request.intent !== "SUBMIT_EXPERIMENT_MANIFEST"
    || request.job_id !== jobId
    || request.manifest_id !== job.production_run_object_id
    || request.design_id !== designId
    || request.idempotency_key !== idempotencyKey
  ) {
    throw new ApiError(409, "Physical AI 설계기의 작업 JSON만 이 영수증 경로에서 처리할 수 있습니다.");
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
  const expectedRequestHash = typeof request.request_hash_sha256 === "string" ? request.request_hash_sha256.toLocaleLowerCase("en-US") : "";
  const expectedDesignHash = typeof request.design_hash_sha256 === "string" ? request.design_hash_sha256.toLocaleLowerCase("en-US") : "";
  const requestBase = { ...request };
  delete requestBase.request_hash_sha256;
  const recomputedRequestHash = await sha256(requestBase);
  if (
    expectedRequestHash !== recomputedRequestHash
    || submittedRequestHash !== expectedRequestHash
    || submittedDesignHash !== expectedDesignHash
    || expectedDesignHash !== plan.designHash
  ) {
    throw new ApiError(409, "영수증의 요청·설계 해시가 저장된 작업 JSON과 일치하지 않습니다.");
  }
  let receiptBase: JsonRecord;
  if (request.schema === "campfire.device-job.v3") {
    if (receipt.schema !== "campfire.device-receipt.v2") throw new ApiError(400, "v3 작업에는 v2 영수증 스키마가 필요합니다.");
    const attemptId = textValue(receipt.attempt_id, "실행 시도 ID", 8, 180);
    if (!/^[a-zA-Z0-9_.:-]+$/.test(attemptId)) throw new ApiError(400, "실행 시도 ID 형식이 올바르지 않습니다.");
    const executionMode = receipt.execution_mode === "PHONE_CLOSED_LOOP" || receipt.execution_mode === "ROS2_SIMULATION"
      ? receipt.execution_mode
      : null;
    if (!executionMode) throw new ApiError(400, "실행 모드는 PHONE_CLOSED_LOOP 또는 ROS2_SIMULATION이어야 합니다.");
    const reasonCode = textValue(receipt.reason_code, "종료 이유 코드", 3, 80).toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(reasonCode)) throw new ApiError(400, "종료 이유 코드는 영문 대문자, 숫자, 밑줄만 사용할 수 있습니다.");
    const terminalStep = textValue(receipt.terminal_step, "종료 단계", 2, 120);
    const metrics = asRecord(receipt.metrics);
    const metricEntries = Object.entries(metrics);
    if (!metricEntries.length || metricEntries.length > 32 || metricEntries.some(([key, value]) => (
      key.length > 80 || !(value === null || ["string", "number", "boolean"].includes(typeof value))
    ))) throw new ApiError(400, "측정 요약은 1~32개의 단순 값이어야 합니다.");
    const artifact = asRecord(receipt.artifact);
    const artifactHash = typeof artifact.hash_sha256 === "string" ? artifact.hash_sha256.toLowerCase() : "";
    const byteLength = artifact.byte_length;
    if (
      artifact.media_type !== "application/json"
      || artifactHash !== evidenceHash
      || !Number.isInteger(byteLength)
      || Number(byteLength) < 2
      || Number(byteLength) > 5_000_000
      || artifact.storage !== "USER_DEVICE_ONLY"
    ) throw new ApiError(400, "증거 artifact의 형식, 길이, 저장 위치 또는 해시가 영수증과 일치하지 않습니다.");
    const scenario = asRecord(request.experiment).scenario;
    if (scenario === "person_following" && executionMode !== "ROS2_SIMULATION") {
      throw new ApiError(409, "사람 추종 작업은 스마트폰에서 ROS2 시뮬레이션으로만 보고할 수 있습니다.");
    }
    if (receipt.physical_execution_verified !== false) throw new ApiError(400, "스마트폰 영수증은 물리 실행을 검증했다고 표시할 수 없습니다.");
    receiptBase = {
      schema: "campfire.device-receipt.v2",
      job_id: jobId,
      idempotency_key: idempotencyKey,
      status,
      device_id: deviceId,
      observed_at: observedAt,
      evidence_hash_sha256: evidenceHash,
      request_hash_sha256: submittedRequestHash,
      design_hash_sha256: submittedDesignHash,
      attempt_id: attemptId,
      execution_mode: executionMode,
      reason_code: reasonCode,
      terminal_step: terminalStep,
      metrics,
      artifact: {
        media_type: "application/json",
        byte_length: byteLength,
        hash_sha256: artifactHash,
        storage: "USER_DEVICE_ONLY",
      },
      verification_scope: "SERVER_JOB_KEYS_AND_HASH_FORMAT_PLUS_CLIENT_HASHED_LOCAL_ARTIFACT_CLAIM",
      physical_execution_verified: false,
    };
  } else {
    receiptBase = {
      schema: "campfire.device-receipt.v1",
      job_id: jobId,
      idempotency_key: idempotencyKey,
      status,
      device_id: deviceId,
      observed_at: observedAt,
      evidence_hash_sha256: evidenceHash,
      request_hash_sha256: submittedRequestHash,
      design_hash_sha256: submittedDesignHash,
      verification_scope: "SCHEMA_JOB_KEY_REQUEST_HASH_DESIGN_HASH_AND_EVIDENCE_HASH_ONLY",
      physical_execution_verified: false,
    };
  }
  const receiptHash = await sha256(receiptBase);
  const receiptPayload = { ...receiptBase, receipt_hash_sha256: receiptHash };
  const verificationScope = String(receiptBase.verification_scope);
  if (["REPORTED_SUCCEEDED", "REPORTED_FAILED", "REPORTED_ABORTED"].includes(job.status)) {
    const storedReceipt = parseJson<{ receipt_hash_sha256?: string }>(job.receipt_json);
    if (storedReceipt?.receipt_hash_sha256 === receiptHash) return row.session_id;
    throw new ApiError(409, "이미 다른 영수증으로 종료된 작업입니다.");
  }
  const claimedAt = now();
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const claimed = await db.prepare(`UPDATE device_jobs SET status = 'RECEIPT_PROCESSING', updated_at = ?
    WHERE id = ? AND user_id = ? AND session_id = ?
      AND (status = 'REQUESTED' OR (status = 'RECEIPT_PROCESSING' AND updated_at < ?))`)
    .bind(claimedAt, job.id, userId, row.session_id, staleBefore).run();
  if ((claimed.meta.changes ?? 0) !== 1) {
    const current = await db.prepare("SELECT status, receipt_json FROM device_jobs WHERE id = ? AND user_id = ?")
      .bind(job.id, userId).first<{ status: string; receipt_json: string | null }>();
    const storedReceipt = parseJson<{ receipt_hash_sha256?: string }>(current?.receipt_json);
    if (storedReceipt?.receipt_hash_sha256 === receiptHash) return row.session_id;
    throw new ApiError(409, current?.status === "RECEIPT_PROCESSING" ? "다른 영수증을 처리 중입니다." : "이 작업은 새 영수증을 받을 수 없는 상태입니다.");
  }

  const timestamp = now();
  const receiptId = id("receipt");
  const reportedStatus = `REPORTED_${status}`;
  const receiptState = `USER_REPORTED_${status}`;
  const nextState = status === "SUCCEEDED" ? "RECEIPT_RECORDED" : status === "ABORTED" ? "EXECUTION_ABORTED" : "FAILURE_REPORTED";
  try {
    await db.batch([
      db.prepare("UPDATE device_jobs SET status = ?, receipt_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'RECEIPT_PROCESSING'")
        .bind(reportedStatus, JSON.stringify(receiptPayload), timestamp, job.id, userId),
      db.prepare("UPDATE ontology_objects SET state = ?, version = version + 1, payload_json = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(reportedStatus, JSON.stringify({
          schema: "campfire.device-job-result.v1",
          request,
          receipt: receiptPayload,
          verification: {
            scope: verificationScope,
            physical_execution_verified: false,
          },
        }), timestamp, job.production_run_object_id, userId),
      db.prepare("UPDATE ontology_objects SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(nextState, timestamp, designId, userId),
      db.prepare("UPDATE cf_sessions SET state = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(nextState, timestamp, row.session_id, userId),
      db.prepare(`INSERT INTO ontology_objects
        (id, session_id, user_id, object_type, state, version, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, 'DeviceReceipt', ?, 1, ?, ?, ?)`).bind(
        receiptId, row.session_id, userId, receiptState, JSON.stringify(receiptPayload), timestamp, timestamp,
      ),
      db.prepare(`INSERT INTO ontology_relations
        (id, session_id, user_id, source_id, predicate, target_id, created_at)
        VALUES (?, ?, ?, ?, 'HAS_RECEIPT', ?, ?)`).bind(
        id("rel"), row.session_id, userId, job.production_run_object_id, receiptId, timestamp,
      ),
      actionStatement(db, {
        userId, sessionId: row.session_id, actionName: "RecordExternalAdapterReceipt", actorRole: "PARTICIPANT_IMPORT",
        targetType: "DeviceJobManifest", targetId: job.production_run_object_id, fromState: "AWAITING_ADAPTER", toState: reportedStatus,
        inputHash: receiptHash, details: {
          device_id: deviceId,
          observed_at: observedAt,
          external_status: status,
          verification_scope: verificationScope,
          physical_execution_verified: false,
        }, timestamp,
      }),
    ]);
  } catch (cause) {
    await db.prepare(`UPDATE device_jobs SET status = 'REQUESTED', updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'RECEIPT_PROCESSING'`).bind(now(), job.id, userId).run();
    throw cause;
  }
  return row.session_id;
}

export async function GET(request: Request) {
  try {
    const { userId } = requireSiteUser(request);
    const db = await getD1();
    const sessionId = new URL(request.url).searchParams.get("session");
    return Response.json(await loadDesigner(db, userId, sessionId));
  } catch (error) {
    if (error instanceof Response) return error;
    const status = error instanceof ApiError ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message : "설계기를 불러오지 못했습니다." }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = requireSiteUser(request);
    const db = await getD1();
    const payload = asRecord(await request.json());
    let sessionId: string;
    switch (payload.action) {
      case "create_design":
        sessionId = await createDesign(db, userId, payload);
        break;
      case "validate_design":
        sessionId = await validateDesign(db, userId, payload);
        break;
      case "issue_device_job":
        sessionId = await issueDeviceJob(db, userId, payload);
        break;
      case "apply_device_receipt":
        sessionId = await applyDeviceReceipt(db, userId, payload);
        break;
      default:
        throw new ApiError(400, "지원하지 않는 작업입니다.");
    }
    return Response.json(await loadDesigner(db, userId, sessionId));
  } catch (error) {
    if (error instanceof Response) return error;
    const status = error instanceof ApiError ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message : "설계 작업을 처리하지 못했습니다." }, { status });
  }
}
