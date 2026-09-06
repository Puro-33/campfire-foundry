// Canonical D1 schema. Each item is exactly one prepared statement.
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS cf_sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, state TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ontology_objects (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL, object_type TEXT NOT NULL,
    state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ontology_relations (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL, source_id TEXT NOT NULL,
    predicate TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS action_events (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL, action_name TEXT NOT NULL,
    actor_role TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, from_state TEXT,
    to_state TEXT NOT NULL, input_hash TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS simulation_runs (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL, scenario TEXT NOT NULL,
    days INTEGER NOT NULL, policies_json TEXT NOT NULL, event_type TEXT, model_version TEXT NOT NULL,
    input_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS device_jobs (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL,
    production_run_object_id TEXT NOT NULL, intent TEXT NOT NULL, status TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE, request_json TEXT NOT NULL, receipt_json TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS physical_ai_design_submissions (
    user_id TEXT NOT NULL, request_id TEXT NOT NULL, design_hash TEXT NOT NULL,
    session_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, request_id)
  )`,
  `CREATE TABLE IF NOT EXISTS physical_ai_validation_submissions (
    user_id TEXT NOT NULL, request_id TEXT NOT NULL, design_id TEXT NOT NULL, input_hash TEXT NOT NULL,
    session_id TEXT NOT NULL, validation_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, request_id)
  )`,
  `CREATE TABLE IF NOT EXISTS physical_ai_operation_locks (
    user_id TEXT NOT NULL, design_id TEXT NOT NULL, lock_token TEXT NOT NULL,
    acquired_at TEXT NOT NULL, PRIMARY KEY (user_id, design_id)
  )`,
  `CREATE TABLE IF NOT EXISTS physical_ai_catalog_meta (
    id TEXT PRIMARY KEY, schema_version TEXT NOT NULL, generated_at TEXT NOT NULL,
    source_commit TEXT NOT NULL, source_url TEXT NOT NULL, source_hash TEXT NOT NULL,
    source_license TEXT NOT NULL, node_count INTEGER NOT NULL, edge_count INTEGER NOT NULL,
    validation_json TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS physical_ai_nodes (
    id TEXT PRIMARY KEY, node_type TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
    claimed_kind TEXT, category_id TEXT, canonical_url TEXT, verification_status TEXT NOT NULL,
    properties_json TEXT NOT NULL, source_url TEXT NOT NULL, source_kind TEXT NOT NULL,
    source_hash TEXT NOT NULL, retrieved_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS physical_ai_relations (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL, predicate TEXT NOT NULL, target_id TEXT NOT NULL,
    confidence REAL NOT NULL, verification_status TEXT NOT NULL, evidence_url TEXT NOT NULL,
    evidence_kind TEXT NOT NULL, evidence_hash TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_cf_sessions_user_updated ON cf_sessions(user_id, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_ontology_objects_session ON ontology_objects(user_id, session_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_ontology_objects_type_state ON ontology_objects(user_id, session_id, object_type, state, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_ontology_relations_session ON ontology_relations(user_id, session_id)",
  "CREATE INDEX IF NOT EXISTS idx_ontology_relations_source ON ontology_relations(user_id, session_id, source_id, predicate)",
  "CREATE INDEX IF NOT EXISTS idx_ontology_relations_target ON ontology_relations(user_id, session_id, target_id, predicate)",
  "CREATE INDEX IF NOT EXISTS idx_action_events_session ON action_events(user_id, session_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_simulation_runs_session ON simulation_runs(user_id, session_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_device_jobs_session ON device_jobs(user_id, session_id, created_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_device_jobs_one_active_manifest ON device_jobs(user_id, session_id) WHERE intent = 'SUBMIT_EXPERIMENT_MANIFEST' AND status IN ('REQUESTED', 'RECEIPT_PROCESSING')",
  "CREATE INDEX IF NOT EXISTS idx_physical_ai_nodes_type_name ON physical_ai_nodes(node_type, name)",
  "CREATE INDEX IF NOT EXISTS idx_physical_ai_nodes_claimed_kind ON physical_ai_nodes(claimed_kind, name)",
  "CREATE INDEX IF NOT EXISTS idx_physical_ai_nodes_category ON physical_ai_nodes(category_id, name)",
  "CREATE INDEX IF NOT EXISTS idx_physical_ai_relations_source ON physical_ai_relations(source_id, predicate)",
  "CREATE INDEX IF NOT EXISTS idx_physical_ai_relations_target ON physical_ai_relations(target_id, predicate)",
] as const;
