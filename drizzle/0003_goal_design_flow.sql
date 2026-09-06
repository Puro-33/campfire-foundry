CREATE TABLE IF NOT EXISTS physical_ai_design_submissions (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  design_hash TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, request_id)
);

CREATE TABLE IF NOT EXISTS physical_ai_validation_submissions (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  design_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  session_id TEXT NOT NULL,
  validation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, request_id)
);

CREATE TABLE IF NOT EXISTS physical_ai_operation_locks (
  user_id TEXT NOT NULL,
  design_id TEXT NOT NULL,
  lock_token TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  PRIMARY KEY (user_id, design_id)
);

CREATE INDEX IF NOT EXISTS idx_ontology_objects_type_state
ON ontology_objects(user_id, session_id, object_type, state, created_at);

CREATE INDEX IF NOT EXISTS idx_ontology_relations_source
ON ontology_relations(user_id, session_id, source_id, predicate);

CREATE INDEX IF NOT EXISTS idx_ontology_relations_target
ON ontology_relations(user_id, session_id, target_id, predicate);

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_jobs_one_active_manifest
ON device_jobs(user_id, session_id)
WHERE intent = 'SUBMIT_EXPERIMENT_MANIFEST'
  AND status IN ('REQUESTED', 'RECEIPT_PROCESSING');

PRAGMA optimize;
