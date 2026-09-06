import catalogJson from "@/data/physical-ai-ontology.v1.json";

type JsonRecord = Record<string, unknown>;

type CatalogNode = {
  id: string;
  type: string;
  name: string;
  description: string;
  properties: JsonRecord;
  provenance: {
    sourceUrl: string;
    sourceKind: string;
    retrievedAt: string;
    sourceHashSha256: string;
  };
};

type CatalogEdge = {
  id: string;
  source: string;
  predicate: string;
  target: string;
  confidence: number;
  verificationStatus: string;
  evidence: {
    sourceUrl: string;
    sourceKind: string;
    sourceHashSha256: string;
  };
};

type CatalogDataset = {
  metadata: {
    schemaVersion: string;
    snapshotHashSha256: string;
    generatedAt: string;
    source: {
      repositoryUrl: string;
      commitSha: string;
      contentSha256: string;
      license: string;
    };
    counts: JsonRecord;
    validation: JsonRecord;
    crawlPolicy: JsonRecord;
  };
  nodes: CatalogNode[];
  edges: CatalogEdge[];
};

const catalog = catalogJson as unknown as CatalogDataset;
let seedReady: Promise<void> | null = null;

function textProperty(properties: JsonRecord, key: string) {
  const value = properties[key];
  return typeof value === "string" && value ? value : null;
}

function chunks<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function executeBatches(db: D1Database, statements: D1PreparedStatement[]) {
  for (const statementBatch of chunks(statements, 40)) await db.batch(statementBatch);
}

function nodeStatements(db: D1Database) {
  return chunks(catalog.nodes, 7).map((rows) => {
    const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const values = rows.flatMap((node) => [
      node.id,
      node.type,
      node.name,
      node.description.slice(0, 1200),
      textProperty(node.properties, "catalogClaimedKind"),
      textProperty(node.properties, "categoryId"),
      textProperty(node.properties, "canonicalUrl"),
      textProperty(node.properties, "verificationStatus") ?? "SOURCE_RECORDED",
      JSON.stringify(node.properties),
      node.provenance.sourceUrl,
      node.provenance.sourceKind,
      node.provenance.sourceHashSha256,
      node.provenance.retrievedAt,
    ]);
    return db.prepare(`INSERT OR REPLACE INTO physical_ai_nodes
      (id, node_type, name, description, claimed_kind, category_id, canonical_url,
       verification_status, properties_json, source_url, source_kind, source_hash, retrieved_at)
      VALUES ${placeholders}`).bind(...values);
  });
}

function relationStatements(db: D1Database) {
  return chunks(catalog.edges, 11).map((rows) => {
    const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const values = rows.flatMap((edge) => [
      edge.id,
      edge.source,
      edge.predicate,
      edge.target,
      edge.confidence,
      edge.verificationStatus,
      edge.evidence.sourceUrl,
      edge.evidence.sourceKind,
      edge.evidence.sourceHashSha256,
    ]);
    return db.prepare(`INSERT OR REPLACE INTO physical_ai_relations
      (id, source_id, predicate, target_id, confidence, verification_status,
       evidence_url, evidence_kind, evidence_hash)
      VALUES ${placeholders}`).bind(...values);
  });
}

async function seed(db: D1Database) {
  const current = await db.prepare("SELECT source_hash FROM physical_ai_catalog_meta WHERE id = 'current'")
    .first<{ source_hash: string }>();
  if (current?.source_hash === catalog.metadata.snapshotHashSha256) return;

  await db.batch([
    db.prepare("DELETE FROM physical_ai_relations"),
    db.prepare("DELETE FROM physical_ai_nodes"),
    db.prepare("DELETE FROM physical_ai_catalog_meta WHERE id = 'current'"),
  ]);
  await executeBatches(db, nodeStatements(db));
  await executeBatches(db, relationStatements(db));

  const validation = {
    ...catalog.metadata.validation,
    counts: catalog.metadata.counts,
    crawlPolicy: catalog.metadata.crawlPolicy,
  };
  await db.prepare(`INSERT INTO physical_ai_catalog_meta
    (id, schema_version, generated_at, source_commit, source_url, source_hash,
     source_license, node_count, edge_count, validation_json, updated_at)
    VALUES ('current', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      catalog.metadata.schemaVersion,
      catalog.metadata.generatedAt,
      catalog.metadata.source.commitSha,
      catalog.metadata.source.repositoryUrl,
      catalog.metadata.snapshotHashSha256,
      catalog.metadata.source.license,
      catalog.nodes.length,
      catalog.edges.length,
      JSON.stringify(validation),
      new Date().toISOString(),
    ).run();
}

export async function ensurePhysicalAiCatalog(db: D1Database) {
  seedReady ??= seed(db).catch((error) => {
    seedReady = null;
    throw error;
  });
  await seedReady;
}
