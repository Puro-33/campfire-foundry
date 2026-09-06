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
  "CREATE INDEX IF NOT EXISTS idx_cf_sessions_user_updated ON cf_sessions(user_id, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_ontology_objects_session ON ontology_objects(user_id, session_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_ontology_relations_session ON ontology_relations(user_id, session_id)",
  "CREATE INDEX IF NOT EXISTS idx_action_events_session ON action_events(user_id, session_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_simulation_runs_session ON simulation_runs(user_id, session_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_device_jobs_session ON device_jobs(user_id, session_id, created_at)",
] as const;

