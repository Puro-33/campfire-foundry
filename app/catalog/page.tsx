"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./catalog.module.css";

type Facet = { value: string; count: number };
type NamedFacet = { id: string; name: string };
type CatalogNode = {
  id: string;
  type: string;
  name: string;
  description: string;
  claimedKind: string | null;
  categoryId: string | null;
  canonicalUrl: string | null;
  verificationStatus: string;
  properties: Record<string, unknown> | null;
  provenance: { sourceUrl: string; sourceKind: string; sourceHashSha256: string; retrievedAt: string };
};
type CatalogRelation = {
  id: string;
  direction: "incoming" | "outgoing";
  predicate: string;
  source: { id: string; name: string; type: string };
  target: { id: string; name: string; type: string };
  confidence: number;
  verificationStatus: string;
  evidence: { url: string; kind: string; hash: string };
};
type CatalogResponse = {
  meta: {
    schemaVersion: string;
    generatedAt: string;
    sourceCommit: string;
    sourceUrl: string;
    sourceHashSha256: string;
    sourceLicense: string;
    nodeCount: number;
    edgeCount: number;
    validation: {
      conforms?: boolean;
      danglingEdges?: number;
      provenanceCoverage?: number;
      counts?: { catalogEntries?: number; verifiedExternalResources?: number; byType?: Record<string, number> };
    } | null;
  };
  facets: { types: Facet[]; claimedKinds: Facet[]; categories: NamedFacet[]; roles: NamedFacet[] };
  results: CatalogNode[];
  selected: null | { node: CatalogNode; relations: CatalogRelation[] };
  error?: string;
};

const statusLabels: Record<string, string> = {
  GITHUB_API_VERIFIED: "GitHub 확인",
  ARXIV_API_VERIFIED: "arXiv 확인",
  INDEX_LINKED: "목록에 명시",
  INDEX_ONLY: "목록 언급만",
  SOURCE_RECORDED: "출처 기록",
  INDEX_LINKED_API_UNRESOLVED: "외부 API 미확인",
  INVALID_OR_PLACEHOLDER_ARXIV_ID: "잘못된 arXiv ID",
};

const predicateLabels: Record<string, string> = {
  HAS_CATEGORY: "분류 포함",
  CONTAINS: "항목 포함",
  SUPPORTS_ROLE: "역할 매핑",
  HAS_PAPER: "논문 연결",
  HAS_CODE: "코드 연결",
  HAS_DATASET: "데이터 연결",
  HAS_PROJECT_PAGE: "프로젝트 페이지",
  HAS_BLOG: "공식 글",
  HAS_DEMO: "데모",
  MAINTAINED_BY: "관리 주체",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function shortHash(value: string) {
  return value ? `${value.slice(0, 10)}…${value.slice(-6)}` : "—";
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusTone(status: string) {
  if (status.includes("VERIFIED")) return styles.verified;
  if (status.includes("INVALID") || status.includes("UNRESOLVED")) return styles.warning;
  return styles.recorded;
}

export default function CatalogPage() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [kind, setKind] = useState("");
  const [category, setCategory] = useState("");
  const [role, setRole] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");

  const requestKey = useMemo(() => JSON.stringify({ query, type, kind, category, role, selectedId }), [query, type, kind, category, role, selectedId]);
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "40" });
    if (query) params.set("q", query);
    if (type) params.set("type", type);
    if (kind) params.set("kind", kind);
    if (category) params.set("category", category);
    if (role) params.set("role", role);
    if (selectedId) params.set("node", selectedId);

    fetch(`/api/catalog?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as CatalogResponse;
        if (!response.ok) throw new Error(payload.error ?? "카탈로그를 불러오지 못했습니다.");
        return payload;
      })
      .then((payload) => {
        setData(payload);
        setError("");
        setLoadedKey(requestKey);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "카탈로그를 불러오지 못했습니다.");
        setLoadedKey(requestKey);
      });
    return () => controller.abort();
  }, [query, type, kind, category, role, selectedId, requestKey]);

  const validation = data?.meta.validation;
  const catalogEntries = validation?.counts?.catalogEntries ?? 0;
  const verifiedResources = validation?.counts?.verifiedExternalResources ?? 0;
  const provenancePercent = Math.round((validation?.provenanceCoverage ?? 0) * 100);

  const selected = data?.selected;
  const selectedProperties = useMemo(() => {
    if (!selected?.node.properties) return [];
    return Object.entries(selected.node.properties)
      .filter(([, value]) => value !== null && value !== "" && !Array.isArray(value))
      .slice(0, 12);
  }, [selected]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSelectedId("");
    setQuery(draftQuery.trim());
  }

  function clearFilters() {
    setDraftQuery("");
    setQuery("");
    setType("");
    setKind("");
    setCategory("");
    setRole("");
    setSelectedId("");
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}><span>CF</span><strong>Campfire Foundry</strong></Link>
        <nav><Link href="/">실험 작업대</Link><a href="#data-scale">데이터 기준</a><a href="https://github.com/Puro-33/campfire-foundry" target="_blank" rel="noreferrer">소스</a></nav>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>PHYSICAL AI / EVIDENCE GRAPH</p>
          <h1>말이 아니라<br /><em>출처를 따라가는</em> 온톨로지</h1>
          <p className={styles.lead}>Awesome Physical AI의 고정 커밋과 사용자가 지정한 OpenCat 저장소를 크롤링했습니다. 항목을 검색하고, 역할·분류로 좁히고, 논문·코드·관리 주체 관계의 근거까지 직접 확인할 수 있습니다.</p>
          <div className={styles.heroActions}><a href="#explorer">그래프 검색하기</a><a href="/api/catalog/export" download>전체 JSON 내려받기</a></div>
        </div>
        <aside className={styles.integrity}>
          <span className={validation?.conforms ? styles.live : styles.warningDot} />
          <div><strong>{validation?.conforms ? "그래프 무결성 통과" : "검증 확인 필요"}</strong><small>중복 ID 0 · 끊어진 관계 {validation?.danglingEdges ?? "—"}</small></div>
          <code>{data?.meta.schemaVersion ?? "불러오는 중"}</code>
        </aside>
      </section>

      <section className={styles.stats} aria-label="크롤링 통계">
        <div><span>노드</span><strong>{formatNumber(data?.meta.nodeCount ?? 0)}</strong><small>언급·논문·코드·조직</small></div>
        <div><span>관계</span><strong>{formatNumber(data?.meta.edgeCount ?? 0)}</strong><small>근거 URL을 가진 연결</small></div>
        <div><span>원 목록 항목</span><strong>{formatNumber(catalogEntries)}</strong><small>사실 승격 전 CatalogMention</small></div>
        <div><span>API 재확인</span><strong>{formatNumber(verifiedResources)}</strong><small>GitHub 공식 API 확인</small></div>
        <div><span>출처 완비</span><strong>{provenancePercent}%</strong><small>URL · 시각 · SHA-256</small></div>
      </section>

      <section className={styles.explorer} id="explorer">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>LIVE QUERY</p><h2>온톨로지 탐색기</h2></div>
          <p>검색 결과는 D1에서 조회됩니다. 카드를 열면 들어오고 나가는 관계와 그 관계를 만든 근거를 볼 수 있습니다.</p>
        </div>

        <form className={styles.filters} onSubmit={submitSearch}>
          <label className={styles.search}><span>이름·설명 검색</span><div><input value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="예: OpenVLA, OpenCat, simulation" maxLength={120} /><button>검색</button></div></label>
          <label><span>실제 노드 유형</span><select value={type} onChange={(event) => { setType(event.target.value); setSelectedId(""); }}><option value="">전체</option>{data?.facets.types.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}</select></label>
          <label><span>목록이 주장한 유형</span><select value={kind} onChange={(event) => { setKind(event.target.value); setSelectedId(""); }}><option value="">전체</option>{data?.facets.claimedKinds.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}</select></label>
          <label><span>실행 역할</span><select value={role} onChange={(event) => { setRole(event.target.value); setSelectedId(""); }}><option value="">전체</option>{data?.facets.roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>README 분류</span><select value={category} onChange={(event) => { setCategory(event.target.value); setSelectedId(""); }}><option value="">전체</option>{data?.facets.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <button type="button" className={styles.clear} onClick={clearFilters}>필터 초기화</button>
        </form>

        {error && <div className={styles.error} role="alert"><strong>조회 실패</strong><span>{error}</span></div>}

        <div className={styles.queryLayout} aria-busy={loading}>
          <div className={styles.results}>
            <div className={styles.resultsHead}><strong>검색 결과</strong><span>{loading ? "조회 중…" : `${data?.results.length ?? 0}개 표시`}</span></div>
            {!loading && data?.results.length === 0 && <div className={styles.empty}>조건에 맞는 노드가 없습니다.</div>}
            {data?.results.map((node) => (
              <article key={node.id} className={selectedId === node.id ? styles.selectedCard : styles.nodeCard}>
                <div className={styles.nodeMeta}><span>{node.type}</span>{node.claimedKind && <i>목록 주장: {node.claimedKind}</i>}</div>
                <h3>{node.name}</h3>
                <p>{node.description}</p>
                <div className={styles.cardFoot}>
                  <span className={`${styles.status} ${statusTone(node.verificationStatus)}`}>{statusLabels[node.verificationStatus] ?? node.verificationStatus}</span>
                  <div><a href={node.provenance.sourceUrl} target="_blank" rel="noreferrer">출처</a><button onClick={() => setSelectedId(node.id)}>관계 보기 →</button></div>
                </div>
              </article>
            ))}
          </div>

          <aside className={styles.detail}>
            {!selected ? (
              <div className={styles.detailEmpty}><span>↗</span><h3>노드를 선택하세요</h3><p>관계 보기 버튼을 누르면 이곳에서 이 노드가 어디서 왔고 무엇과 연결되는지 추적할 수 있습니다.</p></div>
            ) : (
              <>
                <div className={styles.detailTitle}><span>{selected.node.type}</span><h3>{selected.node.name}</h3><p>{selected.node.description}</p></div>
                <div className={styles.provenance}>
                  <strong>PROVENANCE</strong>
                  <dl><div><dt>근거 유형</dt><dd>{selected.node.provenance.sourceKind}</dd></div><div><dt>수집 시각</dt><dd>{displayDate(selected.node.provenance.retrievedAt)}</dd></div><div><dt>근거 해시</dt><dd><code title={selected.node.provenance.sourceHashSha256}>{shortHash(selected.node.provenance.sourceHashSha256)}</code></dd></div></dl>
                  <div className={styles.sourceLinks}><a href={selected.node.provenance.sourceUrl} target="_blank" rel="noreferrer">수집 근거 열기</a>{selected.node.canonicalUrl && <a href={selected.node.canonicalUrl} target="_blank" rel="noreferrer">공식 페이지 열기</a>}</div>
                </div>
                {selectedProperties.length > 0 && <details className={styles.properties}><summary>속성 {selectedProperties.length}개</summary>{selectedProperties.map(([key, value]) => <div key={key}><span>{key}</span><code>{String(value)}</code></div>)}</details>}
                <div className={styles.relationList}>
                  <div className={styles.relationHead}><strong>연결 관계</strong><span>{selected.relations.length}개</span></div>
                  {selected.relations.map((relation) => {
                    const other = relation.direction === "outgoing" ? relation.target : relation.source;
                    return <article key={relation.id}>
                      <span className={styles.direction}>{relation.direction === "outgoing" ? "나감" : "들어옴"}</span>
                      <div><small>{predicateLabels[relation.predicate] ?? relation.predicate} · 신뢰도 {Math.round(relation.confidence * 100)}%</small><button onClick={() => setSelectedId(other.id)}>{other.name}<em>{other.type}</em></button><a href={relation.evidence.url} target="_blank" rel="noreferrer">관계 근거 보기</a></div>
                    </article>;
                  })}
                </div>
              </>
            )}
          </aside>
        </div>
      </section>

      <section className={styles.scale} id="data-scale">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>HOW MUCH DATA?</p><h2>“충분함”은 개수가 아니라 시험으로 결정</h2></div>
          <p>온톨로지 검색과 로봇 정책 학습은 서로 다른 문제입니다. 아래 숫자는 표준이 보장하는 최소치가 아니라 수집을 시작하고 중단 여부를 판단하기 위한 공학적 기준입니다.</p>
        </div>
        <div className={styles.scaleGrid}>
          <article><span>01 / 구조 파일럿</span><h3>수백 개로도 시작 가능</h3><p>핵심 질문 10–20개, 클래스별 대표 사례 5–10개, 중요 관계마다 정상 3개와 오류 1개를 먼저 만듭니다.</p><strong>판정: P0 질문 답변율 100%</strong></article>
          <article><span>02 / 운영 지식그래프</span><h3>원시 개수의 보편적 최소값 없음</h3><p>업무 범위 대비 누락률, 출처 완비율, 제약 위반, 최신성으로 측정합니다. 데이터가 많아도 근거 없는 링크면 실패입니다.</p><strong>판정: 핵심 출처 100% · 차단 위반 0</strong></article>
          <article><span>03 / 좁은 로봇 과업</span><h3>50 에피소드는 첫 수집 구간</h3><p>고정 장치·과업에서 50회부터 학습 곡선을 그리되, 충분성은 별도 물체·조명·배치의 성공률과 안전 결과로 판단합니다.</p><strong>판정: 보류 환경 성공률</strong></article>
          <article><span>04 / 범용 정책</span><h3>수만–백만 궤적 규모</h3><p>SmolVLA 공개 사례는 3만 미만 에피소드, OpenVLA는 97만 시연, Open X-Embodiment는 100만+ 궤적입니다. 이는 비교 사례이지 최소치가 아닙니다.</p><strong>판정: 과업·환경·장치 일반화</strong></article>
        </div>
        <div className={styles.evidenceLinks}>
          <a href="https://www.w3.org/TR/shacl/" target="_blank" rel="noreferrer"><span>W3C</span><strong>SHACL 그래프 검증</strong></a>
          <a href="https://www.w3.org/TR/prov-o/" target="_blank" rel="noreferrer"><span>W3C</span><strong>PROV-O 출처 모델</strong></a>
          <a href="https://robotics-transformer-x.github.io/" target="_blank" rel="noreferrer"><span>OXE</span><strong>1M+ 실제 로봇 궤적</strong></a>
          <a href="https://huggingface.co/blog/smolvla" target="_blank" rel="noreferrer"><span>HF</span><strong>정제·coverage 중심 사례</strong></a>
        </div>
      </section>

      <footer className={styles.footer}>
        <div><strong>수집 스냅샷</strong><p>커밋 {data?.meta.sourceCommit.slice(0, 12) ?? "—"} · {data?.meta.sourceLicense ?? "—"}</p></div>
        <div><strong>무결성</strong><p>스냅샷 해시 {shortHash(data?.meta.sourceHashSha256 ?? "")}</p></div>
        <a href={data?.meta.sourceUrl ?? "https://github.com/keon/awesome-physical-ai"} target="_blank" rel="noreferrer">원본 목록 열기 →</a>
      </footer>
    </main>
  );
}
