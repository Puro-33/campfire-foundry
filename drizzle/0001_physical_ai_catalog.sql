CREATE TABLE IF NOT EXISTS physical_ai_catalog_meta (
  id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_license TEXT NOT NULL,
  node_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  validation_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS physical_ai_nodes (
  id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  claimed_kind TEXT,
  category_id TEXT,
  canonical_url TEXT,
  verification_status TEXT NOT NULL,
  properties_json TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  retrieved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS physical_ai_relations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  target_id TEXT NOT NULL,
  confidence REAL NOT NULL,
  verification_status TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  evidence_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_physical_ai_nodes_type_name
ON physical_ai_nodes(node_type, name);

CREATE INDEX IF NOT EXISTS idx_physical_ai_nodes_claimed_kind
ON physical_ai_nodes(claimed_kind, name);

CREATE INDEX IF NOT EXISTS idx_physical_ai_nodes_category
ON physical_ai_nodes(category_id, name);

CREATE INDEX IF NOT EXISTS idx_physical_ai_relations_source
ON physical_ai_relations(source_id, predicate);

CREATE INDEX IF NOT EXISTS idx_physical_ai_relations_target
ON physical_ai_relations(target_id, predicate);
