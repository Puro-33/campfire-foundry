import { ensurePhysicalAiCatalog } from "@/db/catalog";
import { getD1 } from "@/db";
import { requireSiteUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type NodeRow = {
  id: string;
  node_type: string;
  name: string;
  description: string;
  claimed_kind: string | null;
  category_id: string | null;
  canonical_url: string | null;
  verification_status: string;
  properties_json: string;
  source_url: string;
  source_kind: string;
  source_hash: string;
  retrieved_at: string;
};

type MetaRow = {
  schema_version: string;
  generated_at: string;
  source_commit: string;
  source_url: string;
  source_hash: string;
  source_license: string;
  node_count: number;
  edge_count: number;
  validation_json: string;
};

type RelationRow = {
  id: string;
  source_id: string;
  predicate: string;
  target_id: string;
  confidence: number;
  verification_status: string;
  evidence_url: string;
  evidence_kind: string;
  evidence_hash: string;
  source_name: string;
  source_type: string;
  target_name: string;
  target_type: string;
};

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function boundedParam(params: URLSearchParams, key: string, maximum: number) {
  const value = params.get(key)?.trim() ?? "";
  if (value.length > maximum) throw new ApiError(400, `${key} 값이 너무 깁니다.`);
  return value;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function escapeLike(value: string) {
  return value.replace(/([%_\\])/g, "\\$1");
}

function presentNode(row: NodeRow) {
  return {
    id: row.id,
    type: row.node_type,
    name: row.name,
    description: row.description,
    claimedKind: row.claimed_kind,
    categoryId: row.category_id,
    canonicalUrl: row.canonical_url,
    verificationStatus: row.verification_status,
    properties: parseJson(row.properties_json),
    provenance: {
      sourceUrl: row.source_url,
      sourceKind: row.source_kind,
      sourceHashSha256: row.source_hash,
      retrievedAt: row.retrieved_at,
    },
  };
}

async function loadCatalog(db: D1Database, url: URL) {
  const query = boundedParam(url.searchParams, "q", 120);
  const type = boundedParam(url.searchParams, "type", 60);
  const claimedKind = boundedParam(url.searchParams, "kind", 60);
  const category = boundedParam(url.searchParams, "category", 120);
  const role = boundedParam(url.searchParams, "role", 120);
  const selectedId = boundedParam(url.searchParams, "node", 180);
  const requestedLimit = Number(url.searchParams.get("limit") ?? 30);
  const limit = Number.isFinite(requestedLimit) ? Math.min(60, Math.max(1, Math.round(requestedLimit))) : 30;

  const conditions: string[] = [];
  const values: Array<string | number> = [];
  if (query) {
    conditions.push("(n.name LIKE ? ESCAPE '\\' OR n.description LIKE ? ESCAPE '\\' OR n.claimed_kind LIKE ? ESCAPE '\\')");
    const pattern = `%${escapeLike(query)}%`;
    values.push(pattern, pattern, pattern);
  }
  if (type) {
    conditions.push("n.node_type = ?");
    values.push(type);
  }
  if (claimedKind) {
    conditions.push("n.claimed_kind = ?");
    values.push(claimedKind);
  }
  if (category) {
    conditions.push(`EXISTS (
      SELECT 1 FROM physical_ai_relations category_link
      LEFT JOIN physical_ai_relations resource_link
        ON resource_link.source_id = category_link.target_id
       AND resource_link.predicate NOT IN ('CONTAINS', 'SUPPORTS_ROLE')
      WHERE category_link.source_id = ? AND category_link.predicate = 'CONTAINS'
        AND (category_link.target_id = n.id OR resource_link.target_id = n.id)
    )`);
    values.push(category);
  }
  if (role) {
    conditions.push(`EXISTS (
      SELECT 1 FROM physical_ai_relations category_link
      JOIN physical_ai_relations role_link
        ON role_link.source_id = category_link.source_id
       AND role_link.predicate = 'SUPPORTS_ROLE'
       AND role_link.target_id = ?
      LEFT JOIN physical_ai_relations resource_link
        ON resource_link.source_id = category_link.target_id
       AND resource_link.predicate NOT IN ('CONTAINS', 'SUPPORTS_ROLE')
      WHERE category_link.predicate = 'CONTAINS'
        AND (category_link.target_id = n.id OR resource_link.target_id = n.id)
    )`);
    values.push(role);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [meta, resultsQuery, typeQuery, kindQuery, categoryQuery, roleQuery] = await Promise.all([
    db.prepare(`SELECT schema_version, generated_at, source_commit, source_url, source_hash,
      source_license, node_count, edge_count, validation_json
      FROM physical_ai_catalog_meta WHERE id = 'current'`).first<MetaRow>(),
    db.prepare(`SELECT n.id, n.node_type, n.name, n.description, n.claimed_kind, n.category_id,
      n.canonical_url, n.verification_status, n.properties_json, n.source_url, n.source_kind,
      n.source_hash, n.retrieved_at
      FROM physical_ai_nodes n ${where}
      ORDER BY CASE n.node_type WHEN 'CatalogMention' THEN 0 WHEN 'Repository' THEN 1 WHEN 'Paper' THEN 2 ELSE 3 END,
      n.name COLLATE NOCASE LIMIT ?`).bind(...values, limit).all<NodeRow>(),
    db.prepare("SELECT node_type AS value, COUNT(*) AS count FROM physical_ai_nodes GROUP BY node_type ORDER BY count DESC")
      .all<{ value: string; count: number }>(),
    db.prepare("SELECT claimed_kind AS value, COUNT(*) AS count FROM physical_ai_nodes WHERE claimed_kind IS NOT NULL GROUP BY claimed_kind ORDER BY count DESC")
      .all<{ value: string; count: number }>(),
    db.prepare("SELECT id, name FROM physical_ai_nodes WHERE node_type = 'Category' ORDER BY name COLLATE NOCASE")
      .all<{ id: string; name: string }>(),
    db.prepare("SELECT id, name FROM physical_ai_nodes WHERE node_type = 'OperationalRole' ORDER BY name COLLATE NOCASE")
      .all<{ id: string; name: string }>(),
  ]);
  if (!meta) throw new ApiError(503, "카탈로그 데이터가 아직 준비되지 않았습니다.");

  let selected = null;
  if (selectedId) {
    const node = await db.prepare(`SELECT id, node_type, name, description, claimed_kind, category_id,
      canonical_url, verification_status, properties_json, source_url, source_kind, source_hash, retrieved_at
      FROM physical_ai_nodes WHERE id = ?`).bind(selectedId).first<NodeRow>();
    if (!node) throw new ApiError(404, "선택한 온톨로지 노드를 찾을 수 없습니다.");
    const relationQuery = await db.prepare(`SELECT r.id, r.source_id, r.predicate, r.target_id, r.confidence,
      r.verification_status, r.evidence_url, r.evidence_kind, r.evidence_hash,
      source.name AS source_name, source.node_type AS source_type,
      target.name AS target_name, target.node_type AS target_type
      FROM physical_ai_relations r
      JOIN physical_ai_nodes source ON source.id = r.source_id
      JOIN physical_ai_nodes target ON target.id = r.target_id
      WHERE r.source_id = ? OR r.target_id = ?
      ORDER BY r.predicate, source.name, target.name LIMIT 100`).bind(selectedId, selectedId).all<RelationRow>();
    selected = {
      node: presentNode(node),
      relations: (relationQuery.results ?? []).map((relation) => ({
        id: relation.id,
        direction: relation.source_id === selectedId ? "outgoing" : "incoming",
        predicate: relation.predicate,
        source: { id: relation.source_id, name: relation.source_name, type: relation.source_type },
        target: { id: relation.target_id, name: relation.target_name, type: relation.target_type },
        confidence: relation.confidence,
        verificationStatus: relation.verification_status,
        evidence: { url: relation.evidence_url, kind: relation.evidence_kind, hash: relation.evidence_hash },
      })),
    };
  }

  return {
    meta: {
      schemaVersion: meta.schema_version,
      generatedAt: meta.generated_at,
      sourceCommit: meta.source_commit,
      sourceUrl: meta.source_url,
      sourceHashSha256: meta.source_hash,
      sourceLicense: meta.source_license,
      nodeCount: meta.node_count,
      edgeCount: meta.edge_count,
      validation: parseJson(meta.validation_json),
    },
    facets: {
      types: typeQuery.results ?? [],
      claimedKinds: kindQuery.results ?? [],
      categories: categoryQuery.results ?? [],
      roles: roleQuery.results ?? [],
    },
    query: { q: query, type, kind: claimedKind, category, role, limit },
    results: (resultsQuery.results ?? []).map(presentNode),
    selected,
  };
}

export async function GET(request: Request) {
  try {
    requireSiteUser(request);
    const db = await getD1();
    await ensurePhysicalAiCatalog(db);
    return Response.json(await loadCatalog(db, new URL(request.url)));
  } catch (error) {
    if (error instanceof Response) return error;
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "카탈로그를 불러오지 못했습니다.";
    return Response.json({ error: message }, { status });
  }
}
