"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type PolicySpec = { key: string; label: string; min: number; max: number; initial: number };
type SessionSummary = { id: string; name: string; state: string; created_at: string; updated_at: string };
type OntologyObject = {
  id: string;
  object_type: string;
  state: string;
  version: number;
  payload: Record<string, unknown>;
  created_at: string;
};
type Relation = { id: string; source_id: string; predicate: string; target_id: string; created_at: string };
type ActionEvent = {
  id: string;
  action_name: string;
  actor_role: string;
  target_type: string;
  target_id: string;
  from_state: string | null;
  to_state: string;
  input_hash: string;
  created_at: string;
};
type SimulationRun = {
  id: string;
  scenario: string;
  days: number;
  event_type: string | null;
  model_version: string;
  input_hash: string;
  policies: Record<string, number>;
  result: {
    finalSnapshot?: { metrics?: Record<string, number>; guards?: Record<string, boolean>; advice?: string[] };
    summary?: {
      operations?: Record<string, number | null>;
      averages?: Record<string, number>;
      finance?: Record<string, number | Record<string, number>>;
      criticalAnyDays?: number;
    };
  };
  created_at: string;
};
type DeviceJob = {
  id: string;
  production_run_object_id: string;
  intent: string;
  status: string;
  idempotency_key: string;
  request: Record<string, unknown>;
  receipt: Record<string, unknown> | null;
  created_at: string;
};
type Workspace = {
  persisted: boolean;
  model: string;
  policies: PolicySpec[];
  scenarios: Array<{ value: string; label: string }>;
  events: Array<{ value: string; label: string }>;
  sessions: SessionSummary[];
  active: null | {
    session: SessionSummary;
    objects: OntologyObject[];
    relations: Relation[];
    actions: ActionEvent[];
    runs: SimulationRun[];
    jobs: DeviceJob[];
  };
};

const stateLabels: Record<string, string> = {
  EVIDENCE_SAVED: "근거 저장",
  READY_TO_SIMULATE: "검토 완료",
  NEEDS_REVIEW: "재검토 필요",
  SIMULATED: "서버 계산 완료",
  DEVICE_JOB_REQUESTED: "장치 영수증 대기",
  COMPLETED: "실행 확인",
  DEVICE_FAILED: "장치 실행 실패",
  ACTIVE: "활성",
  PROPOSED: "검토 대기",
  CONFIRMED: "사람 확인",
  CONTESTED: "반박됨",
  SELECTED: "선택됨",
  APPROVED: "승인됨",
  REQUESTED: "요청됨",
  SUCCEEDED: "성공",
  FAILED: "실패",
  ABORTED: "중단",
};

const typeLabels: Record<string, string> = {
  EvidenceSession: "근거 세션",
  EvidenceItem: "근거",
  Hypothesis: "가설",
  Review: "사람 검토",
  ProductSpec: "선택 정책",
  ProductionPlan: "시뮬레이션 계획",
  ProductionRun: "장치 작업",
  DeviceReceipt: "장치 영수증",
};

function shortId(value: string) {
  const [prefix, rest = ""] = value.split("_");
  return `${prefix}_${rest.slice(0, 8)}`;
}

function formatNumber(value: unknown, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits }).format(number)
    : "—";
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function stateLabel(value: string) {
  return stateLabels[value] ?? value;
}

function objectSummary(object: OntologyObject) {
  const payload = object.payload ?? {};
  if (typeof payload.content_summary === "string") return payload.content_summary;
  if (typeof payload.statement === "string") return payload.statement;
  if (typeof payload.name === "string") return payload.name;
  if (typeof payload.verdict === "string") return `${payload.verdict} · ${String(payload.note ?? "메모 없음")}`;
  if (typeof payload.simulation_model_version === "string") return String(payload.simulation_model_version);
  if (typeof payload.device_id === "string") return `${payload.device_id} · ${String(payload.status ?? object.state)}`;
  return "구조화 데이터";
}

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [sessionForm, setSessionForm] = useState({
    name: "",
    testimony: "",
    distanceKm: "",
    dwellMinutes: "",
    consent: false,
  });
  const [reviewNote, setReviewNote] = useState("");
  const [scenario, setScenario] = useState("balanced");
  const [days, setDays] = useState(180);
  const [eventType, setEventType] = useState("");
  const [policies, setPolicies] = useState<Record<string, number>>({});
  const [receiptText, setReceiptText] = useState("");

  const load = useCallback(async (sessionId?: string | null) => {
    setBusy("load");
    setError(null);
    try {
      const suffix = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
      const response = await fetch(`/api/workspace${suffix}`, { cache: "no-store" });
      const data = await response.json() as Workspace & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "작업 공간을 불러오지 못했습니다.");
      setWorkspace(data);
      setSelectedSession(data.active?.session.id ?? null);
      setPolicies(Object.fromEntries(data.policies.map((policy) => [
        policy.key,
        Number(data.active?.runs[0]?.policies?.[policy.key] ?? policy.initial),
      ])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "작업 공간을 불러오지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    // Initial network synchronization intentionally hydrates client state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function post(action: string, payload: Record<string, unknown>, success: string) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await response.json() as Workspace & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "작업을 완료하지 못했습니다.");
      setWorkspace(data);
      setSelectedSession(data.active?.session.id ?? null);
      setPolicies(Object.fromEntries(data.policies.map((policy) => [
        policy.key,
        Number(data.active?.runs[0]?.policies?.[policy.key] ?? policies[policy.key] ?? policy.initial),
      ])));
      setNotice(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "작업을 완료하지 못했습니다.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createSession(event: FormEvent) {
    event.preventDefault();
    const ok = await post("create_session", {
      ...sessionForm,
      distanceKm: Number(sessionForm.distanceKm),
      dwellMinutes: Number(sessionForm.dwellMinutes),
    }, "입력 근거와 제안 가설을 D1에 저장했습니다.");
    if (ok) {
      setSessionForm({ name: "", testimony: "", distanceKm: "", dwellMinutes: "", consent: false });
      setReviewNote("");
    }
  }

  async function selectSession(sessionId: string) {
    setSelectedSession(sessionId);
    await load(sessionId);
  }

  async function review(verdict: "CONFIRMED" | "CONTESTED") {
    if (!workspace?.active) return;
    await post("review_hypothesis", {
      sessionId: workspace.active.session.id,
      verdict,
      note: reviewNote,
    }, verdict === "CONFIRMED" ? "사람 검토를 기록했습니다." : "반박과 메모를 기록했습니다.");
  }

  async function runSimulation(event: FormEvent) {
    event.preventDefault();
    if (!workspace?.active) return;
    await post("simulate", {
      sessionId: workspace.active.session.id,
      scenario,
      days,
      eventType: eventType || null,
      policies,
    }, "서버 엔진이 계산했고 결과·모델 버전·입력 해시를 저장했습니다.");
  }

  async function createDeviceJob() {
    if (!workspace?.active) return;
    await post("create_device_job", {
      sessionId: workspace.active.session.id,
      intent: "BEEP",
    }, "BEEP 작업을 생성했습니다. 장치 영수증 전에는 성공으로 표시하지 않습니다.");
  }

  function downloadJob(job: DeviceJob) {
    const blob = new Blob([JSON.stringify(job.request, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${job.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function applyReceipt() {
    if (!workspace?.active) return;
    try {
      const receipt = JSON.parse(receiptText) as Record<string, unknown>;
      const ok = await post("apply_device_receipt", {
        sessionId: workspace.active.session.id,
        receipt,
      }, "영수증 형식과 작업 키의 일치를 확인해 결과 근거로 연결했습니다.");
      if (ok) setReceiptText("");
    } catch {
      setError("영수증이 올바른 JSON인지 확인하세요.");
    }
  }

  function readReceiptFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setReceiptText(String(reader.result ?? ""));
    reader.onerror = () => setError("영수증 파일을 읽지 못했습니다.");
    reader.readAsText(file);
  }

  const active = workspace?.active;
  const hypothesis = active?.objects.findLast((object) => object.object_type === "Hypothesis");
  const evidence = active?.objects.filter((object) => object.object_type === "EvidenceItem" && object.payload.epistemic_class !== "OUTCOME") ?? [];
  const latestRun = active?.runs[0];
  const latestJob = active?.jobs[0];
  const metrics = latestRun?.result.finalSnapshot?.metrics ?? {};
  const operations = latestRun?.result.summary?.operations ?? {};
  const averages = latestRun?.result.summary?.averages ?? {};
  const finance = latestRun?.result.summary?.finance ?? {};
  const hypothesisConfirmed = hypothesis?.state === "CONFIRMED";

  const progress = useMemo(() => {
    if (!active) return 0;
    if (latestJob?.status === "SUCCEEDED") return 5;
    if (latestJob) return 4;
    if (latestRun) return 3;
    if (hypothesisConfirmed) return 2;
    return 1;
  }, [active, latestJob, latestRun, hypothesisConfirmed]);

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Campfire Foundry 처음으로">
          <span>CF</span>
          <div><strong>Campfire Foundry</strong><small>실제 데이터 워크벤치</small></div>
        </a>
        <div className="system-badges" aria-label="실행 환경">
          <span className="online"><i />D1 저장</span>
          <span>서버 계산</span>
          <span>영수증 기반 장치 상태</span>
        </div>
      </header>

      <section className="intro" id="top">
        <div>
          <p className="eyebrow">WORKING PRODUCT / V2</p>
          <h1>입력하고, 저장하고,<br />실행 흔적을 확인하세요.</h1>
        </div>
        <p className="intro-copy">
          이 화면은 합성 성공을 보여주지 않습니다. 사용자가 넣은 근거는 데이터베이스에 남고,
          시뮬레이션은 서버에서 실행되며, 장치는 일치하는 영수증이 들어와야만 완료됩니다.
        </p>
      </section>

      <div className="proof-strip" aria-label="실제 기능">
        <div><b>01</b><strong>사용자 입력</strong><span>빈 양식에서 시작</span></div>
        <div><b>02</b><strong>영구 저장</strong><span>새로고침 후 복원</span></div>
        <div><b>03</b><strong>서버 모델</strong><span>버전·입력 해시 기록</span></div>
        <div><b>04</b><strong>온톨로지</strong><span>객체·관계·Action 감사</span></div>
        <div><b>05</b><strong>장치 경계</strong><span>영수증 없이는 성공 금지</span></div>
      </div>

      {(error || notice) && (
        <div className={error ? "message error" : "message success"} role={error ? "alert" : "status"}>
          <span>{error ? "확인 필요" : "완료"}</span>
          <p>{error ?? notice}</p>
          <button onClick={() => { setError(null); setNotice(null); }} aria-label="메시지 닫기">×</button>
        </div>
      )}

      <div className="app-shell">
        <aside className="session-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">SAVED SESSIONS</p><h2>실험 세션</h2></div>
            <button className="icon-button" onClick={() => void load(selectedSession)} disabled={busy === "load"} aria-label="세션 새로고침">↻</button>
          </div>

          <form className="new-session" onSubmit={createSession}>
            <label>
              세션 이름
              <input value={sessionForm.name} onChange={(event) => setSessionForm({ ...sessionForm, name: event.target.value })} placeholder="예: 9월 학교–공장 실험" maxLength={80} required />
            </label>
            <label>
              사람의 증언
              <textarea value={sessionForm.testimony} onChange={(event) => setSessionForm({ ...sessionForm, testimony: event.target.value })} placeholder="관찰한 상황과 의미를 직접 입력하세요." maxLength={1200} required />
            </label>
            <div className="field-pair">
              <label>거리 (km)<input type="number" min="0" max="500" step="0.01" value={sessionForm.distanceKm} onChange={(event) => setSessionForm({ ...sessionForm, distanceKm: event.target.value })} required /></label>
              <label>체류 (분)<input type="number" min="0" max="1440" step="1" value={sessionForm.dwellMinutes} onChange={(event) => setSessionForm({ ...sessionForm, dwellMinutes: event.target.value })} required /></label>
            </div>
            <label className="consent">
              <input type="checkbox" checked={sessionForm.consent} onChange={(event) => setSessionForm({ ...sessionForm, consent: event.target.checked })} />
              <span>이 요약을 비공개 실험 기록으로 저장하는 데 동의합니다.</span>
            </label>
            <button className="primary" disabled={Boolean(busy) || !sessionForm.consent}>근거 세션 생성</button>
          </form>

          <div className="session-list">
            {workspace?.sessions.map((session) => (
              <button key={session.id} className={session.id === selectedSession ? "session active" : "session"} onClick={() => void selectSession(session.id)}>
                <strong>{session.name}</strong>
                <span>{stateLabel(session.state)} · {timeLabel(session.updated_at)}</span>
              </button>
            ))}
            {!busy && workspace?.sessions.length === 0 && <p className="empty">아직 저장된 세션이 없습니다.</p>}
          </div>
        </aside>

        <section className="workspace" aria-busy={Boolean(busy)}>
          {!active ? (
            <div className="blank-state">
              <span>01</span>
              <h2>왼쪽 양식에 실제 근거를 입력하세요.</h2>
              <p>예시 데이터는 자동으로 채우지 않습니다. 생성 버튼을 누르면 D1 저장과 온톨로지 객체 생성이 함께 실행됩니다.</p>
            </div>
          ) : (
            <>
              <div className="workspace-head">
                <div>
                  <p className="eyebrow">ACTIVE SESSION / {shortId(active.session.id)}</p>
                  <h2>{active.session.name}</h2>
                </div>
                <span className={"state-pill " + active.session.state.toLowerCase()}>{stateLabel(active.session.state)}</span>
              </div>

              <ol className="progress" aria-label="작업 진행 상태">
                {["근거", "사람 검토", "서버 계산", "장치 작업", "실행 결과"].map((label, index) => (
                  <li key={label} className={progress > index ? "done" : progress === index ? "current" : ""}>
                    <span>{index + 1}</span><strong>{label}</strong>
                  </li>
                ))}
              </ol>

              <section className="work-card" aria-labelledby="evidence-title">
                <div className="card-title">
                  <span>01</span>
                  <div><p className="eyebrow">EVIDENCE → HYPOTHESIS</p><h3 id="evidence-title">저장된 근거와 검토</h3></div>
                </div>
                <div className="evidence-grid">
                  {evidence.map((item) => (
                    <article key={item.id}>
                      <small>{shortId(item.id)} · {String(item.payload.epistemic_class ?? "UNKNOWN")}</small>
                      <p>{String(item.payload.content_summary ?? "")}</p>
                      <span>{String(item.payload.kind ?? item.object_type)}</span>
                    </article>
                  ))}
                </div>
                {hypothesis && (
                  <div className="hypothesis">
                    <div><small>RULE/TEMPLATE-V1 · {shortId(hypothesis.id)}</small><strong>{String(hypothesis.payload.statement ?? "")}</strong></div>
                    <span className={"state-pill " + hypothesis.state.toLowerCase()}>{stateLabel(hypothesis.state)}</span>
                    <label>
                      검토 메모
                      <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="왜 확인하거나 반박하는지 남기세요." maxLength={600} />
                    </label>
                    <div className="button-row">
                      <button className="primary" disabled={Boolean(busy)} onClick={() => void review("CONFIRMED")}>가설 확인 및 기록</button>
                      <button className="secondary danger" disabled={Boolean(busy)} onClick={() => void review("CONTESTED")}>반박 기록</button>
                    </div>
                  </div>
                )}
              </section>

              <section className="work-card" aria-labelledby="simulation-title">
                <div className="card-title">
                  <span>02</span>
                  <div><p className="eyebrow">SERVER SIMULATION</p><h3 id="simulation-title">검증된 정책 엔진 실행</h3></div>
                  <em>{workspace.model}</em>
                </div>
                <form onSubmit={runSimulation}>
                  <div className="sim-options">
                    <label>시나리오<select value={scenario} onChange={(event) => setScenario(event.target.value)}>{workspace.scenarios.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                    <label>기간 (일)<input type="number" min="30" max="365" value={days} onChange={(event) => setDays(Number(event.target.value))} /></label>
                    <label>추가 사건<select value={eventType} onChange={(event) => setEventType(event.target.value)}>{workspace.events.map((item) => <option key={item.value || "none"} value={item.value}>{item.label}</option>)}</select></label>
                  </div>
                  <div className="policy-grid">
                    {workspace.policies.map((policy) => (
                      <label className="policy" key={policy.key}>
                        <span><strong>{policy.label}</strong><output>{policies[policy.key] ?? policy.initial}</output></span>
                        <input type="range" min={policy.min} max={policy.max} step="1" value={policies[policy.key] ?? policy.initial} onChange={(event) => setPolicies({ ...policies, [policy.key]: Number(event.target.value) })} disabled={!hypothesisConfirmed || Boolean(busy)} />
                        <small>{policy.min}–{policy.max} · {policy.key}</small>
                      </label>
                    ))}
                  </div>
                  {!hypothesisConfirmed && <p className="gate-note">먼저 가설을 사람이 확인해야 서버 실행이 열립니다.</p>}
                  <button className="primary run" disabled={!hypothesisConfirmed || Boolean(busy)}>{busy === "simulate" ? "서버 계산 중…" : "서버에서 실행하고 저장"}</button>
                </form>

                {latestRun && (
                  <div className="result-block" aria-live="polite">
                    <div className="result-head">
                      <div><small>RUN {shortId(latestRun.id)}</small><strong>{latestRun.model_version}</strong></div>
                      <span>입력 해시 {latestRun.input_hash.slice(0, 12)}…</span>
                    </div>
                    <div className="metric-grid">
                      <div><span>연결성</span><strong>{formatNumber(metrics.connection)}</strong><small>평균 {formatNumber(averages.connection)}</small></div>
                      <div><span>역량 준비도</span><strong>{formatNumber(metrics.readiness)}</strong><small>수요 {formatNumber(metrics.requiredSkill)}</small></div>
                      <div><span>양품 생산</span><strong>{formatNumber(operations.goodUnits)}<i> units</i></strong><small>서비스 {formatNumber(operations.demandServiceLevel)}%</small></div>
                      <div><span>가중 결함률</span><strong>{formatNumber(operations.weightedDefectRate, 2)}<i>%</i></strong><small>안전 {formatNumber(metrics.safety)}</small></div>
                      <div><span>합산 현금</span><strong>{formatNumber(metrics.combinedCash)}<i>M</i></strong><small>순영업 {formatNumber(finance.partnershipNetOperatingFlow)}M</small></div>
                      <div><span>중대 위험일</span><strong>{formatNumber(latestRun.result.summary?.criticalAnyDays)}<i>일</i></strong><small>{latestRun.scenario} · {latestRun.days}일</small></div>
                    </div>
                  </div>
                )}
              </section>

              <section className="work-card" aria-labelledby="device-title">
                <div className="card-title">
                  <span>03</span>
                  <div><p className="eyebrow">DEVICE JOB / RECEIPT</p><h3 id="device-title">장치 작업은 결과를 연출하지 않습니다</h3></div>
                </div>
                <p className="explain">사이트는 로컬 USB·시리얼에 직접 접근하지 않습니다. 승인된 BEEP 작업 JSON을 장치 게이트웨이에 전달하고, 같은 멱등 키를 가진 영수증을 가져와야 상태가 바뀝니다.</p>
                {!latestJob ? (
                  <button className="primary" disabled={!latestRun || Boolean(busy)} onClick={() => void createDeviceJob()}>
                    {latestRun ? "BEEP 장치 작업 생성" : "서버 계산 후 장치 작업 생성"}
                  </button>
                ) : (
                  <div className="device-console">
                    <div className="job-summary">
                      <div><small>JOB ID</small><code>{latestJob.id}</code></div>
                      <div><small>INTENT</small><strong>{latestJob.intent}</strong></div>
                      <div><small>STATUS</small><span className={"state-pill " + latestJob.status.toLowerCase()}>{stateLabel(latestJob.status)}</span></div>
                      <button className="secondary" onClick={() => downloadJob(latestJob)}>작업 JSON 다운로드</button>
                    </div>
                    {latestJob.receipt ? (
                      <div className="receipt-ok">
                        <span>사용자가 가져온 영수증 · 작업 키 일치</span>
                        <strong>{String(latestJob.receipt.device_id ?? "unknown device")} · {stateLabel(latestJob.status)}</strong>
                        <code>{String(latestJob.receipt.observed_at ?? "")}</code>
                      </div>
                    ) : (
                      <div className="receipt-import">
                        <div>
                          <strong>장치 영수증 가져오기</strong>
                          <p>필수 필드: job_id, idempotency_key, device_id, observed_at, status.</p>
                        </div>
                        <label className="file-button">JSON 파일 선택<input type="file" accept=".json,application/json" onChange={readReceiptFile} /></label>
                        <textarea value={receiptText} onChange={(event) => setReceiptText(event.target.value)} placeholder={JSON.stringify({ job_id: latestJob.id, idempotency_key: latestJob.idempotency_key, device_id: "gateway-device-id", observed_at: new Date().toISOString(), status: "SUCCEEDED" }, null, 2)} />
                        <button className="primary" disabled={!receiptText.trim() || Boolean(busy)} onClick={() => void applyReceipt()}>영수증 형식·작업 키 확인</button>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="work-card" aria-labelledby="ontology-title">
                <div className="card-title">
                  <span>04</span>
                  <div><p className="eyebrow">ONTOLOGY + AUDIT</p><h3 id="ontology-title">화면 장식이 아닌 저장 레코드</h3></div>
                  <em>{active.objects.length} objects · {active.relations.length} links · {active.actions.length} actions</em>
                </div>
                <div className="ledger-grid">
                  <div className="ledger">
                    <div className="ledger-head"><span>객체</span><span>상태</span><span>내용</span></div>
                    {active.objects.slice().reverse().map((object) => (
                      <div className="ledger-row" key={object.id}>
                        <span><b>{typeLabels[object.object_type] ?? object.object_type}</b><code>{shortId(object.id)} · v{object.version}</code></span>
                        <span><i className={"dot " + object.state.toLowerCase()} />{stateLabel(object.state)}</span>
                        <p>{objectSummary(object)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="audit">
                    <strong>ACTION LOG</strong>
                    {active.actions.map((action) => (
                      <article key={action.id}>
                        <span>{timeLabel(action.created_at)}</span>
                        <b>{action.action_name}</b>
                        <p>{action.actor_role} · {action.from_state ?? "∅"} → {action.to_state}</p>
                        <code>{action.input_hash.slice(0, 16)}…</code>
                      </article>
                    ))}
                  </div>
                </div>
                <details className="relations">
                  <summary>관계 레코드 {active.relations.length}개 보기</summary>
                  {active.relations.map((relation) => (
                    <code key={relation.id}>{shortId(relation.source_id)} —{relation.predicate}→ {shortId(relation.target_id)}</code>
                  ))}
                </details>
              </section>
            </>
          )}
        </section>
      </div>

      <footer>
        <div><strong>무엇이 실제인가</strong><p>D1 저장, 서버 실행, 해시·모델 버전, 객체·관계·Action 로그, 영수증의 형식·작업 키 검사.</p></div>
        <div><strong>무엇이 아직 아닌가</strong><p>직접 장치 연결, 자연어 AI 호출, 실시간 센서 스트림. 해당 게이트웨이가 확인되기 전에는 연결됐다고 표시하지 않습니다.</p></div>
        <a href="https://github.com/Puro-33/campfire-foundry" target="_blank" rel="noreferrer">Private source ↗</a>
      </footer>
    </main>
  );
}
