import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const OWNER = "keon";
const REPO = "awesome-physical-ai";
const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;
const OUTPUT_PATH = path.resolve("data/physical-ai-ontology.v1.json");
const USER_AGENT = "campfire-foundry-ontology-crawler/1.0";
const EXTRACTOR_VERSION = "campfire-crawler/1.2.0";
const EXTRA_REPOSITORIES = [
  {
    fullName: "PetoiCamp/OpenCat-Quadruped-Robot",
    name: "OpenCat Quadruped Robot",
    roleId: "role:execution",
    reason: "사용자가 직접 지정한 장치 실행 저장소",
  },
];
const githubToken = process.env.GITHUB_TOKEN?.trim();
const skipArxiv = process.argv.includes("--skip-arxiv") || process.env.SKIP_ARXIV === "1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compactId(prefix, value) {
  return `${prefix}:${sha256(value).slice(0, 18)}`;
}

function slug(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || sha256(value).slice(0, 12);
}

function cleanText(value) {
  return value
    .replace(/\[\[?[^\]]+\]\(https?:\/\/[^)]+\)\]?/g, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:.-]+|[\s.-]+$/g, "")
    .trim();
}

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function request(url, { json = false, github = false } = {}) {
  const headers = { "user-agent": USER_AGENT, accept: json ? "application/json" : "text/plain" };
  if (github) {
    headers.accept = "application/vnd.github+json";
    headers["x-github-api-version"] = "2022-11-28";
    if (githubToken) headers.authorization = `Bearer ${githubToken}`;
  }
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return json ? response.json() : response.text();
}

async function mapLimit(items, limit, task) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

function githubCoordinates(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const [owner, repository] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !repository || ["topics", "collections", "orgs", "users", "search"].includes(owner)) return null;
    return { owner, repository: repository.replace(/\.git$/, ""), key: `${owner}/${repository.replace(/\.git$/, "")}`.toLowerCase() };
  } catch {
    return null;
  }
}

function arxivId(url) {
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([^?#/]+(?:\/[^?#/]+)?)/i);
  return match?.[1]?.replace(/\.pdf$/i, "") ?? null;
}

function resourceKind(url) {
  if (arxivId(url)) return "Paper";
  if (githubCoordinates(url)) return "Repository";
  return "WebResource";
}

function linkPredicate(label, kind) {
  if (/paper|report/i.test(label)) return "HAS_PAPER";
  if (/code|github/i.test(label)) return "HAS_CODE";
  if (/dataset/i.test(label)) return "HAS_DATASET";
  if (kind === "Paper") return "HAS_PAPER";
  if (kind === "Repository") return "HAS_CODE";
  if (kind === "Dataset") return "HAS_DATASET";
  if (/blog/i.test(label)) return "HAS_BLOG";
  if (/demo/i.test(label)) return "HAS_DEMO";
  return "HAS_PROJECT_PAGE";
}

function entryKind(section, subsection, name) {
  const context = `${section} ${subsection} ${name}`.toLowerCase();
  if (subsection.toLowerCase().includes("datasets & benchmarks")) return "DatasetOrBenchmark";
  if (context.includes("simulation platform")) return "Simulator";
  if (context.includes("companies & projects")) return "OrganizationOrProject";
  return "ResearchWork";
}

function markdownText(value) {
  return cleanText(value.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1"));
}

const roleRules = [
  { id: "role:sensing", label: "감지·표현", pattern: /foundations|visual representation/i },
  { id: "role:world-model", label: "세계 예측", pattern: /world models/i },
  { id: "role:reasoning", label: "추론·계획", pattern: /reasoning|planning/i },
  { id: "role:policy", label: "행동 정책", pattern: /vla|action representation|learning paradigms|scaling|lifelong|applications/i },
  { id: "role:simulation", label: "시뮬레이션", pattern: /sim-to-real|simulation platforms/i },
  { id: "role:control", label: "제어·안전", pattern: /deployment|safety|alignment/i },
  { id: "role:execution", label: "장치 실행", pattern: /companies|projects/i },
];

const classes = [
  ["Catalog", "수집된 온톨로지 스냅샷"],
  ["Category", "원 목록의 분류"],
  ["OperationalRole", "Campfire Foundry의 물리 AI 실행 역할"],
  ["CatalogMention", "원 목록에서 수집한 항목; 사실 개체로 승격되기 전 단계"],
  ["Paper", "논문 원문 레코드"],
  ["Repository", "소스 코드 저장소"],
  ["Organization", "저장소 관리 주체"],
  ["WebResource", "공식 프로젝트·데모·블로그 페이지"],
];

const predicates = [
  ["HAS_CATEGORY", "카탈로그가 분류를 포함"],
  ["CONTAINS", "분류가 항목을 포함"],
  ["SUPPORTS_ROLE", "분류가 실행 역할에 기여하는 설계 매핑"],
  ["HAS_PAPER", "항목이 논문 링크를 명시"],
  ["HAS_CODE", "항목이 코드 링크를 명시"],
  ["HAS_DATASET", "항목이 데이터셋 링크를 명시"],
  ["HAS_PROJECT_PAGE", "항목이 프로젝트 페이지를 명시"],
  ["HAS_BLOG", "항목이 블로그를 명시"],
  ["HAS_DEMO", "항목이 데모를 명시"],
  ["MAINTAINED_BY", "GitHub API가 저장소 소유자를 확인"],
];

const collectedAt = new Date().toISOString();
const repository = await request(API_ROOT, { json: true, github: true });
const commit = await request(`${API_ROOT}/commits/${repository.default_branch}`, { json: true, github: true });
const sourceCommit = commit.sha;
const readmeUrl = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${sourceCommit}/README.md`;
const readmeBlobUrl = `https://github.com/${OWNER}/${REPO}/blob/${sourceCommit}/README.md`;
const readme = await request(readmeUrl);
const sourceHash = sha256(readme);

const nodes = new Map();
const edges = new Map();
const addNode = (node) => {
  const existing = nodes.get(node.id);
  if (existing) {
    existing.properties = { ...existing.properties, ...node.properties };
    existing.provenance = node.provenance ?? existing.provenance;
    return existing;
  }
  nodes.set(node.id, node);
  return node;
};
const addEdge = (source, predicate, target, evidence, confidence = 1, verificationStatus = "SOURCE_EXPLICIT") => {
  const id = compactId("edge", `${source}|${predicate}|${target}`);
  if (!edges.has(id)) edges.set(id, { id, source, predicate, target, confidence, verificationStatus, evidence });
};

const sourceProvenance = (line = 1) => ({
  sourceUrl: `${readmeBlobUrl}#L${line}`,
  sourceKind: "CURATED_INDEX",
  retrievedAt: collectedAt,
  sourceHashSha256: sourceHash,
  sourceCommit,
});

addNode({
  id: "catalog:awesome-physical-ai",
  type: "Catalog",
  name: "Awesome Physical AI",
  description: repository.description,
  properties: {
    canonicalUrl: repository.html_url,
    license: repository.license?.spdx_id ?? "UNKNOWN",
    starsAtCrawl: repository.stargazers_count,
    forksAtCrawl: repository.forks_count,
    defaultBranch: repository.default_branch,
    sourceCommit,
  },
  provenance: sourceProvenance(1),
});

for (const rule of roleRules) {
  addNode({
    id: rule.id,
    type: "OperationalRole",
    name: rule.label,
    description: "Campfire Foundry 통합 설계에서 사용하는 역할 분류",
    properties: { mappingVersion: "campfire-role-map/1.0", assertedBySource: false },
    provenance: {
      sourceUrl: "urn:campfire-foundry:role-map:1.0",
      sourceKind: "DESIGN_INFERENCE",
      retrievedAt: collectedAt,
      sourceHashSha256: sha256("campfire-role-map/1.0"),
    },
  });
}

const categoryIds = new Map();
function categoryId(section, subsection, line) {
  const pathLabel = subsection ? `${section} / ${subsection}` : section;
  if (categoryIds.has(pathLabel)) return categoryIds.get(pathLabel);
  const id = `category:${slug(pathLabel)}`;
  categoryIds.set(pathLabel, id);
  addNode({
    id,
    type: "Category",
    name: pathLabel,
    description: "Awesome Physical AI README의 원 분류",
    properties: { section, subsection: subsection || null },
    provenance: sourceProvenance(line),
  });
  addEdge("catalog:awesome-physical-ai", "HAS_CATEGORY", id, sourceProvenance(line));
  const rule = roleRules.find((candidate) => candidate.pattern.test(pathLabel));
  if (rule) {
    addEdge(id, "SUPPORTS_ROLE", rule.id, {
      sourceUrl: "urn:campfire-foundry:role-map:1.0",
      sourceKind: "DESIGN_INFERENCE",
      retrievedAt: collectedAt,
      sourceHashSha256: sha256("campfire-role-map/1.0"),
    }, 0.65, "DESIGN_MAPPING");
  }
  return id;
}

const lines = readme.split(/\r?\n/);
let section = "Uncategorized";
let subsection = "";
let currentEntry = null;
let tableHeaders = null;
const parsedEntries = [];

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  const h2 = line.match(/^## (.+)$/);
  const h3 = line.match(/^### (.+)$/);
  if (h2) {
    section = cleanText(h2[1]);
    subsection = "";
    currentEntry = null;
    tableHeaders = null;
    continue;
  }
  if (h3) {
    subsection = cleanText(h3[1]);
    currentEntry = null;
    tableHeaders = null;
    continue;
  }
  const tableRow = line.match(/^\|(.+)\|\s*$/);
  if (tableRow) {
    const cells = tableRow[1].split("|").map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    if (!tableHeaders) {
      tableHeaders = cells.map(markdownText);
      continue;
    }
    const name = markdownText(cells[0]);
    if (!name) continue;
    const links = [];
    for (const link of line.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
      links.push({ label: cleanText(link[1]), url: link[2].trim() });
    }
    const structuredFields = Object.fromEntries(tableHeaders.slice(1).map((header, cellIndex) => [header || `column_${cellIndex + 2}`, markdownText(cells[cellIndex + 1] ?? "")]));
    const description = Object.entries(structuredFields).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(" · ");
    const category = categoryId(section, subsection, index + 1);
    const entryId = compactId("entry", `${section}|${subsection}|${name}|line:${index + 1}`);
    currentEntry = { id: entryId, name, title: name, description, category, line: index + 1, links, summary: "", structuredFields };
    parsedEntries.push(currentEntry);
    continue;
  }
  if (line.trim()) tableHeaders = null;
  const match = line.match(/^- \*\*([^*]+)\*\*:\s*(.*)$/);
  if (match && match[1] !== "TL;DR") {
    const name = cleanText(match[1]);
    const body = match[2];
    const quotedTitle = body.match(/"([^"]+)"/)?.[1]?.trim();
    const links = [];
    for (const link of body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
      links.push({ label: cleanText(link[1]), url: link[2].trim() });
    }
    const category = categoryId(section, subsection, index + 1);
    const entryId = compactId("entry", `${section}|${subsection}|${name}|line:${index + 1}`);
    const description = cleanText(body);
    currentEntry = { id: entryId, name, title: quotedTitle || name, description, category, line: index + 1, links, summary: "" };
    parsedEntries.push(currentEntry);
    continue;
  }
  const tldr = line.match(/^\s+- \*\*TL;DR\*\*:\s*(.+)$/);
  if (currentEntry && tldr) currentEntry.summary = cleanText(tldr[1]);
}

for (const entry of parsedEntries) {
  const category = nodes.get(entry.category);
  const kind = entryKind(category?.properties?.section ?? "", category?.properties?.subsection ?? "", entry.name);
  addNode({
    id: entry.id,
    type: "CatalogMention",
    name: entry.name,
    description: entry.summary || entry.description || entry.title,
    properties: {
      title: entry.title,
      catalogClaimedKind: kind,
      categoryId: entry.category,
      sourceLine: entry.line,
      linkCount: entry.links.length,
      verificationStatus: entry.links.length ? "INDEX_LINKED" : "INDEX_ONLY",
      ...(entry.structuredFields ? { catalogFields: entry.structuredFields } : {}),
    },
    provenance: sourceProvenance(entry.line),
  });
  addEdge(entry.category, "CONTAINS", entry.id, sourceProvenance(entry.line));

  for (const link of entry.links) {
    const kind = resourceKind(link.url);
    const coordinates = githubCoordinates(link.url);
    const paperId = arxivId(link.url);
    const resourceId = paperId
      ? `paper:arxiv:${paperId.toLowerCase()}`
      : coordinates
        ? `repo:github:${coordinates.key}`
        : compactId(kind.toLowerCase(), link.url);
    addNode({
      id: resourceId,
      type: kind,
      name: paperId ? `arXiv ${paperId}` : coordinates ? coordinates.key : link.label || new URL(link.url).hostname,
      description: `${entry.name}에 연결된 ${link.label || kind} 리소스`,
      properties: {
        canonicalUrl: link.url,
        linkLabel: link.label,
        verificationStatus: "INDEX_LINKED",
        catalogClaimedKind: /paper|report/i.test(link.label)
          ? "Paper"
          : /dataset/i.test(link.label)
            ? "Dataset"
            : /benchmark/i.test(link.label)
              ? "Benchmark"
              : /code|github/i.test(link.label)
                ? "Repository"
                : "WebResource",
        ...(paperId ? { arxivId: paperId } : {}),
        ...(coordinates ? { githubFullName: coordinates.key } : {}),
      },
      provenance: sourceProvenance(entry.line),
    });
    addEdge(entry.id, linkPredicate(link.label, kind), resourceId, sourceProvenance(entry.line));
  }
}

addNode({
  id: "catalog:user-scoped-sources",
  type: "Catalog",
  name: "User-scoped primary sources",
  description: "사용자가 조사 범위에 직접 지정한 1차 출처",
  properties: { assertedByAwesomePhysicalAi: false },
  provenance: {
    sourceUrl: "urn:campfire-foundry:user-scoped-sources",
    sourceKind: "USER_SCOPE",
    retrievedAt: collectedAt,
    sourceHashSha256: sha256("campfire-foundry:user-scoped-sources"),
  },
});

for (const extra of EXTRA_REPOSITORIES) {
  const canonicalUrl = `https://github.com/${extra.fullName}`;
  const coordinates = githubCoordinates(canonicalUrl);
  if (!coordinates) continue;
  const category = "category:user-scoped-device-execution";
  const mention = compactId("entry", `${extra.fullName}|user-scoped`);
  const repositoryId = `repo:github:${coordinates.key}`;
  const provenance = {
    sourceUrl: canonicalUrl,
    sourceKind: "USER_SCOPED_PRIMARY_SOURCE",
    retrievedAt: collectedAt,
    sourceHashSha256: sha256(canonicalUrl),
  };
  addNode({ id: category, type: "Category", name: "User scoped / Device execution", description: "사용자가 지정한 장치 실행 1차 출처", properties: { section: "User scoped", subsection: "Device execution" }, provenance });
  addNode({ id: mention, type: "CatalogMention", name: extra.name, description: extra.reason, properties: { title: extra.name, catalogClaimedKind: "Repository", categoryId: category, verificationStatus: "USER_SCOPED" }, provenance });
  addNode({ id: repositoryId, type: "Repository", name: coordinates.key, description: extra.reason, properties: { canonicalUrl, linkLabel: "Code", catalogClaimedKind: "Repository", githubFullName: coordinates.key, verificationStatus: "USER_SCOPED_PENDING_API" }, provenance });
  addEdge("catalog:user-scoped-sources", "HAS_CATEGORY", category, provenance);
  addEdge(category, "CONTAINS", mention, provenance);
  addEdge(mention, "HAS_CODE", repositoryId, provenance);
  addEdge(category, "SUPPORTS_ROLE", extra.roleId, {
    sourceUrl: "urn:campfire-foundry:role-map:1.0",
    sourceKind: "DESIGN_INFERENCE",
    retrievedAt: collectedAt,
    sourceHashSha256: sha256("campfire-role-map/1.0"),
  }, 0.65, "DESIGN_MAPPING");
}

const arxivNodes = [...nodes.values()].filter((node) => node.type === "Paper" && node.properties.arxivId);
const validArxiv = arxivNodes.filter((node) => /^\d{4}\.\d{4,5}(v\d+)?$/.test(node.properties.arxivId));
const arxivById = new Map(validArxiv.map((node) => [node.properties.arxivId.replace(/v\d+$/, ""), node]));
for (let start = 0; !skipArxiv && start < validArxiv.length; start += 80) {
  const ids = validArxiv.slice(start, start + 80).map((node) => node.properties.arxivId.replace(/v\d+$/, ""));
  try {
    const xml = await request(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(ids.join(","))}&max_results=${ids.length}`);
    for (const block of xml.match(/<entry>([\s\S]*?)<\/entry>/g) ?? []) {
      const id = block.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/)?.[1]?.replace(/v\d+$/, "");
      const node = id ? arxivById.get(id) : null;
      if (!node) continue;
      const title = decodeXml(block.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
      const authors = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].map((match) => decodeXml(match[1]));
      const primaryCategory = block.match(/<arxiv:primary_category[^>]+term="([^"]+)"/)?.[1] ?? null;
      node.name = title || node.name;
      node.description = title || node.description;
      node.properties = {
        ...node.properties,
        title,
        authors,
        publishedAt: block.match(/<published>([^<]+)<\/published>/)?.[1] ?? null,
        updatedAt: block.match(/<updated>([^<]+)<\/updated>/)?.[1] ?? null,
        primaryCategory,
        verificationStatus: "ARXIV_API_VERIFIED",
      };
    }
  } catch (error) {
    process.stderr.write(`arXiv batch skipped: ${error.message}\n`);
  }
  if (start + 80 < validArxiv.length) await new Promise((resolve) => setTimeout(resolve, 1200));
}

const repoNodes = [...nodes.values()].filter((node) => node.type === "Repository" && node.properties.githubFullName);
await mapLimit(repoNodes, 8, async (node) => {
  try {
    const metadata = await request(`https://api.github.com/repos/${node.properties.githubFullName}`, { json: true, github: true });
    node.name = metadata.full_name;
    node.description = metadata.description || node.description;
    node.properties = {
      ...node.properties,
      canonicalUrl: metadata.html_url,
      githubFullName: metadata.full_name,
      defaultBranch: metadata.default_branch,
      license: metadata.license?.spdx_id ?? "UNKNOWN",
      primaryLanguage: metadata.language,
      starsAtCrawl: metadata.stargazers_count,
      forksAtCrawl: metadata.forks_count,
      archived: metadata.archived,
      pushedAt: metadata.pushed_at,
      updatedAt: metadata.updated_at,
      verificationStatus: "GITHUB_API_VERIFIED",
    };
    node.provenance = {
      sourceUrl: metadata.url,
      sourceKind: "GITHUB_API",
      retrievedAt: collectedAt,
      sourceHashSha256: sha256(JSON.stringify({
        full_name: metadata.full_name,
        owner: metadata.owner.login,
        license: metadata.license?.spdx_id ?? null,
        pushed_at: metadata.pushed_at,
        updated_at: metadata.updated_at,
      })),
    };
    const ownerId = `org:github:${metadata.owner.login.toLowerCase()}`;
    addNode({
      id: ownerId,
      type: "Organization",
      name: metadata.owner.login,
      description: `GitHub ${metadata.owner.type} 계정`,
      properties: { canonicalUrl: metadata.owner.html_url, githubLogin: metadata.owner.login, accountType: metadata.owner.type },
      provenance: {
        sourceUrl: metadata.owner.url,
        sourceKind: "GITHUB_API",
        retrievedAt: collectedAt,
        sourceHashSha256: sha256(JSON.stringify({ login: metadata.owner.login, id: metadata.owner.id, type: metadata.owner.type })),
      },
    });
    addEdge(node.id, "MAINTAINED_BY", ownerId, {
      sourceUrl: metadata.url,
      sourceKind: "GITHUB_API",
      retrievedAt: collectedAt,
      sourceHashSha256: sha256(JSON.stringify({ full_name: metadata.full_name, owner: metadata.owner.login })),
    }, 1, "API_VERIFIED");
  } catch (error) {
    node.properties.verificationStatus = "INDEX_LINKED_API_UNRESOLVED";
    node.properties.apiError = String(error.message).slice(0, 160);
  }
});

for (const node of arxivNodes) {
  if (!/^\d{4}\.\d{4,5}(v\d+)?$/.test(node.properties.arxivId)) {
    node.properties.verificationStatus = "INVALID_OR_PLACEHOLDER_ARXIV_ID";
  } else if (node.properties.verificationStatus !== "ARXIV_API_VERIFIED") {
    node.properties.verificationStatus = "INDEX_LINKED_API_UNRESOLVED";
  }
}

const nodeList = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
const edgeList = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
const snapshotHash = sha256(JSON.stringify({
  sourceHash,
  extractorVersion: EXTRACTOR_VERSION,
  nodes: nodeList.map((node) => ({ id: node.id, type: node.type, properties: node.properties })),
  edges: edgeList.map((edge) => ({ source: edge.source, predicate: edge.predicate, target: edge.target, status: edge.verificationStatus })),
}));
const nodeIds = new Set(nodeList.map((node) => node.id));
const duplicateNodeIds = nodeList.length - nodeIds.size;
const danglingEdges = edgeList.filter((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target));
const provenanceComplete = nodeList.filter((node) => node.provenance?.sourceUrl && node.provenance?.retrievedAt && node.provenance?.sourceHashSha256).length;
const verifiedResources = nodeList.filter((node) => ["ARXIV_API_VERIFIED", "GITHUB_API_VERIFIED"].includes(node.properties?.verificationStatus)).length;

const countBy = (items, key) => Object.fromEntries([...items.reduce((map, item) => {
  const value = item[key] ?? "UNKNOWN";
  map.set(value, (map.get(value) ?? 0) + 1);
  return map;
}, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)));

const dataset = {
  metadata: {
    schemaVersion: "physical-ai-ontology/1.0.0",
    snapshotHashSha256: snapshotHash,
    generatedAt: collectedAt,
    source: {
      title: "Awesome Physical AI",
      repositoryUrl: repository.html_url,
      additionalSources: EXTRA_REPOSITORIES.map((item) => `https://github.com/${item.fullName}`),
      readmeUrl,
      commitSha: sourceCommit,
      contentSha256: sourceHash,
      license: repository.license?.spdx_id ?? "UNKNOWN",
    },
    crawlPolicy: {
      primarySourcesOnly: true,
      extractorVersion: EXTRACTOR_VERSION,
      explicitEdgesOnly: true,
      inferredRoleEdgesMarked: true,
      storesFullArxivAbstracts: false,
    },
    counts: {
      nodes: nodeList.length,
      edges: edgeList.length,
      catalogEntries: nodeList.filter((node) => node.type === "CatalogMention").length,
      byType: countBy(nodeList, "type"),
      byPredicate: countBy(edgeList, "predicate"),
      verifiedExternalResources: verifiedResources,
    },
    validation: {
      conforms: duplicateNodeIds === 0 && danglingEdges.length === 0 && provenanceComplete === nodeList.length,
      duplicateNodeIds,
      danglingEdges: danglingEdges.length,
      provenanceCoverage: Number((provenanceComplete / nodeList.length).toFixed(4)),
      checks: ["unique node ids", "all edge endpoints exist", "all nodes have source URL, retrieval time, and source hash"],
    },
  },
  schema: {
    standardAlignment: {
      provenance: "W3C PROV-O inspired entity/activity/agent provenance",
      constraints: "SHACL-inspired required-field and graph-integrity checks",
    },
    classes: classes.map(([id, description]) => ({ id, description })),
    predicates: predicates.map(([id, description]) => ({ id, description })),
    requiredNodeFields: ["id", "type", "name", "properties", "provenance.sourceUrl", "provenance.retrievedAt", "provenance.sourceHashSha256"],
    requiredEdgeFields: ["id", "source", "predicate", "target", "confidence", "verificationStatus", "evidence.sourceUrl"],
  },
  nodes: nodeList,
  edges: edgeList,
};

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(dataset.metadata, null, 2)}\n`);
