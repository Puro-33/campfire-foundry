import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputPath = path.resolve(process.argv[2] ?? "data/physical-ai-ontology.v1.json");
const outputPath = path.resolve(process.argv[3] ?? "drizzle/0002_physical_ai_seed.sql");
const catalog = JSON.parse(await readFile(inputPath, "utf8"));

if (!Array.isArray(catalog.nodes) || !Array.isArray(catalog.edges)) {
  throw new Error("Ontology snapshot must contain node and edge arrays.");
}

const nodeIds = new Set(catalog.nodes.map((node) => node.id));
const edgeIds = new Set(catalog.edges.map((edge) => edge.id));
const hasDuplicateIds = nodeIds.size !== catalog.nodes.length || edgeIds.size !== catalog.edges.length;
const danglingEdges = catalog.edges.filter(
  (edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target),
);
const missingProvenance = catalog.nodes.filter(
  (node) => !node.provenance?.sourceUrl || !node.provenance?.sourceHashSha256 || !node.provenance?.retrievedAt,
);
const countsMatch = catalog.metadata?.counts?.nodes === catalog.nodes.length
  && catalog.metadata?.counts?.edges === catalog.edges.length;

if (
  catalog.metadata?.validation?.conforms !== true
  || hasDuplicateIds
  || danglingEdges.length > 0
  || missingProvenance.length > 0
  || !countsMatch
) {
  throw new Error("Refusing to generate a migration from an invalid ontology snapshot.");
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertStatements(table, columns, rows, chunkSize) {
  const statements = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    const values = rows.slice(index, index + chunkSize)
      .map((row) => `(${row.map(sqlValue).join(", ")})`)
      .join(",\n");
    statements.push(`INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES\n${values};`);
  }
  return statements;
}

const nodeRows = catalog.nodes.map((node) => [
  node.id,
  node.type,
  node.name,
  node.description.slice(0, 1200),
  node.properties?.catalogClaimedKind ?? null,
  node.properties?.categoryId ?? null,
  node.properties?.canonicalUrl ?? null,
  node.properties?.verificationStatus ?? "SOURCE_RECORDED",
  JSON.stringify(node.properties ?? {}),
  node.provenance.sourceUrl,
  node.provenance.sourceKind,
  node.provenance.sourceHashSha256,
  node.provenance.retrievedAt,
]);

const relationRows = catalog.edges.map((edge) => [
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

const validation = {
  ...catalog.metadata.validation,
  counts: catalog.metadata.counts,
  crawlPolicy: catalog.metadata.crawlPolicy,
};

const metaRow = [[
  "current",
  catalog.metadata.schemaVersion,
  catalog.metadata.generatedAt,
  catalog.metadata.source.commitSha,
  catalog.metadata.source.repositoryUrl,
  catalog.metadata.snapshotHashSha256,
  catalog.metadata.source.license,
  catalog.nodes.length,
  catalog.edges.length,
  JSON.stringify(validation),
  catalog.metadata.generatedAt,
]];

const sql = [
  "-- Generated from data/physical-ai-ontology.v1.json. Do not hand-edit.",
  "DELETE FROM physical_ai_relations;",
  "DELETE FROM physical_ai_nodes;",
  "DELETE FROM physical_ai_catalog_meta WHERE id = 'current';",
  ...insertStatements(
    "physical_ai_nodes",
    ["id", "node_type", "name", "description", "claimed_kind", "category_id", "canonical_url", "verification_status", "properties_json", "source_url", "source_kind", "source_hash", "retrieved_at"],
    nodeRows,
    12,
  ),
  ...insertStatements(
    "physical_ai_relations",
    ["id", "source_id", "predicate", "target_id", "confidence", "verification_status", "evidence_url", "evidence_kind", "evidence_hash"],
    relationRows,
    20,
  ),
  ...insertStatements(
    "physical_ai_catalog_meta",
    ["id", "schema_version", "generated_at", "source_commit", "source_url", "source_hash", "source_license", "node_count", "edge_count", "validation_json", "updated_at"],
    metaRow,
    1,
  ),
  "PRAGMA optimize;",
  "",
].join("\n\n");

await writeFile(outputPath, sql, "utf8");
process.stdout.write(`${outputPath}\n${catalog.nodes.length} nodes, ${catalog.edges.length} edges\n`);
