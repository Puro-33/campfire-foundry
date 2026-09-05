"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ReviewState = "pending" | "confirmed" | "contested";
type ManufacturingState = "locked" | "idle" | "approved" | "running" | "succeeded";
type DecisionKey = "price" | "marketing" | "rnd" | "production" | "quality" | "reserve";

type Decisions = {
  price: number;
  marketing: number;
  rnd: number;
  production: number;
  quality: number;
  reserve: number;
};

type EventData = {
  label: string;
  title: string;
  description: string;
  marketSize: number;
  segments: [number, number, number];
  marketingMultiplier: number;
  capacityMultiplier: number;
  costMultiplier: number;
  wasteFee: number;
};

type Team = {
  id: string;
  name: string;
  strategy: string;
  tone: string;
  decisions: Decisions;
  ecoReputation: number;
  storyFit: number;
};

type SimulationRow = {
  id: string;
  name: string;
  strategy: string;
  tone: string;
  awareness: number;
  personalization: number;
  demand: number;
  produced: number;
  sold: number;
  waste: number;
  wasteRate: number;
  onTime: number;
  revenue: number;
  profit: number;
  cash: number;
  marketShare: number;
  customerScore: number;
  enterpriseValue: number;
  balancedScore: number;
};

type SimulationResult = {
  rows: SimulationRow[];
  user: SimulationRow;
  warnings: string[];
  reasons: string[];
};

type RoundRecord = {
  round: number;
  user: SimulationRow;
};

const initialDecisions: Decisions = {
  price: 29,
  marketing: 6.5,
  rnd: 7,
  production: 980,
  quality: 82,
  reserve: 55,
};

const evidence = [
  {
    id: "E1",
    kind: "합성 증언",
    title: "능선에서 함께 멈춘 순간을 남기고 싶어요.",
    detail: "학습용 합성 발언 · 실제 음성 수집 없음",
  },
  {
    id: "E2",
    kind: "경로 사건",
    title: "6.37 km 기록에서 7분간 체류로 표시된 구간",
    detail: "사회적 동행 판정 아님 · 사람 확인 필요 · 시작·종료 위치 200 m 흐림",
  },
];

const events: EventData[] = [
  {
    label: "연습 라운드",
    title: "모닥불 테스트 마켓",
    description: "조작법과 가치사슬의 상호작용을 익힙니다. 결과는 본 점수에 포함되지 않습니다.",
    marketSize: 4000,
    segments: [45, 35, 20],
    marketingMultiplier: 1.1,
    capacityMultiplier: 1,
    costMultiplier: 1,
    wasteFee: 2,
  },
  {
    label: "본 라운드 1 / 3",
    title: "커뮤니티 출시 축제",
    description: "시장 관심이 커졌습니다. 인지도 투자와 충분한 재고가 초기 점유율을 좌우합니다.",
    marketSize: 4200,
    segments: [55, 25, 20],
    marketingMultiplier: 1.25,
    capacityMultiplier: 1,
    costMultiplier: 1,
    wasteFee: 2,
  },
  {
    label: "본 라운드 2 / 3",
    title: "재료 공급 충격",
    description: "가용 생산능력이 15% 줄고 원가가 18% 상승합니다. 현금 완충과 수요 예측이 중요합니다.",
    marketSize: 3900,
    segments: [60, 22, 18],
    marketingMultiplier: 1,
    capacityMultiplier: 0.85,
    costMultiplier: 1.18,
    wasteFee: 3,
  },
  {
    label: "본 라운드 3 / 3",
    title: "맞춤·친환경 전환",
    description: "고객 선호가 개인화와 지속가능성으로 이동하고, 남은 재료의 폐기 비용이 커집니다.",
    marketSize: 4400,
    segments: [35, 35, 30],
    marketingMultiplier: 1,
    capacityMultiplier: 1,
    costMultiplier: 1.05,
    wasteFee: 8,
  },
];

const competitors: Team[] = [
  {
    id: "swift",
    name: "SwiftLoop",
    strategy: "저가·대량",
    tone: "rose",
    decisions: { price: 22, marketing: 9, rnd: 2.5, production: 1550, quality: 62, reserve: 45 },
    ecoReputation: 25,
    storyFit: 42,
  },
  {
    id: "atelier",
    name: "Atelier N",
    strategy: "고급·개인화",
    tone: "cobalt",
    decisions: { price: 39, marketing: 4, rnd: 11, production: 720, quality: 94, reserve: 36 },
    ecoReputation: 58,
    storyFit: 74,
  },
  {
    id: "moss",
    name: "Moss Mile",
    strategy: "친환경",
    tone: "pine",
    decisions: { price: 33, marketing: 5, rnd: 6, production: 900, quality: 87, reserve: 60 },
    ecoReputation: 96,
    storyFit: 67,
  },
];

const chain = [
  ["01", "현장 근거", "동의된 말과 흐린 경로"],
  ["02", "사람의 판단", "AI 가설 확인·반박"],
  ["03", "기업 결정", "시장·제품·생산·재무"],
  ["04", "제어와 실행", "승인된 모의 액추에이터"],
  ["05", "학습 결과", "경쟁 성과와 예측 오차"],
];

const formatNumber = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function simulate(
  decisions: Decisions,
  event: EventData,
  startingCash: number,
  previousWasteRate: number,
  profitHistory: number[],
): SimulationResult {
  const teams: Team[] = [
    {
      id: "ember",
      name: "Ember Labs",
      strategy: "증거 기반",
      tone: "amber",
      decisions,
      ecoReputation: 72,
      storyFit: 92,
    },
    ...competitors,
  ];

  const features = teams.map((team) => {
    const d = team.decisions;
    const priceValue = clamp((45 - d.price) * 4.2);
    const awareness = clamp(18 + 7 * d.marketing * event.marketingMultiplier);
    const personalization = clamp(8 * d.rnd);
    const produced = Math.round(d.production * event.capacityMultiplier);
    const availability = clamp(produced / 15);
    const priorWaste = team.id === "ember" ? previousWasteRate : team.id === "swift" ? 14 : team.id === "atelier" ? 5 : 7;
    const eco = clamp(0.45 * d.quality + 0.25 * personalization + 0.3 * team.ecoReputation - 0.4 * priorWaste);
    const utilities = [
      10 + 0.45 * priceValue + 0.25 * awareness + 0.2 * availability + 0.1 * d.quality,
      10 + 0.08 * priceValue + 0.12 * awareness + 0.38 * personalization + 0.34 * d.quality + 0.08 * availability,
      10 + 0.1 * priceValue + 0.1 * awareness + 0.15 * personalization + 0.25 * d.quality + 0.32 * eco + 0.08 * availability,
    ];
    return { team, priceValue, awareness, personalization, produced, eco, utilities };
  });

  const utilityTotals = [0, 1, 2].map((segment) =>
    features.reduce((sum, feature) => sum + feature.utilities[segment] ** 2, 0),
  );

  const preliminary = features.map((feature) => {
    const d = feature.team.decisions;
    const demand = [0, 1, 2].reduce((sum, segment) => {
      const segmentSize = event.marketSize * (event.segments[segment] / 100);
      const interestShare = feature.utilities[segment] ** 2 / utilityTotals[segment];
      return sum + segmentSize * interestShare;
    }, 0);
    const yieldRate = 0.84 + 0.0016 * d.quality;
    const sellable = Math.floor(feature.produced * yieldRate);
    const sold = Math.min(Math.round(demand), sellable);
    const waste = Math.max(0, feature.produced - sold);
    const wasteRate = (waste / Math.max(feature.produced, 1)) * 100;
    const onTime = clamp((sold / Math.max(demand, 1)) * 100);
    const unitCost = (7 + 0.065 * d.quality + 0.045 * feature.personalization) * event.costMultiplier;
    const revenue = (d.price * sold) / 1000;
    const profit =
      revenue -
      (unitCost * feature.produced) / 1000 -
      (event.wasteFee * waste) / 1000 -
      d.marketing -
      d.rnd * 0.55 -
      2.5;
    const cashBase = feature.team.id === "ember" ? startingCash : 80;
    const cash = cashBase + profit;
    const customerScore = clamp(
      0.34 * d.quality +
        0.23 * feature.personalization +
        0.2 * onTime +
        0.13 * feature.priceValue +
        0.1 * feature.team.storyFit,
    );
    const profitSeries = feature.team.id === "ember" ? [...profitHistory, profit] : [profit];
    const averageProfit = profitSeries.reduce((sum, value) => sum + value, 0) / profitSeries.length;
    const enterpriseValue = Math.max(
      0,
      cash + 4 * Math.max(averageProfit, 0) + 0.3 * revenue * (customerScore / 100) - 2 * Math.max(-cash, 0),
    );
    const profitabilityScore = clamp(50 + profit * 4);
    const balancedScore = clamp(
      0.28 * profitabilityScore +
        0.2 * onTime +
        0.2 * feature.team.storyFit +
        0.17 * (100 - wasteRate) +
        0.15 * customerScore,
    );

    return {
      id: feature.team.id,
      name: feature.team.name,
      strategy: feature.team.strategy,
      tone: feature.team.tone,
      awareness: feature.awareness,
      personalization: feature.personalization,
      demand,
      produced: feature.produced,
      sold,
      waste,
      wasteRate,
      onTime,
      revenue,
      profit,
      cash,
      marketShare: 0,
      customerScore,
      enterpriseValue,
      balancedScore,
    };
  });

  const totalSales = preliminary.reduce((sum, row) => sum + row.sold, 0);
  const rows = preliminary
    .map((row) => ({ ...row, marketShare: (row.sold / Math.max(totalSales, 1)) * 100 }))
    .sort((a, b) => b.balancedScore - a.balancedScore);
  const user = rows.find((row) => row.id === "ember") as SimulationRow;
  const warnings: string[] = [];
  const reasons: string[] = [];

  if (user.produced > user.demand * 1.18) {
    warnings.push("수요보다 생산이 많아 재고·폐기 비용이 커질 수 있습니다.");
    reasons.push("높은 생산량이 납기를 지켰지만 판매되지 않은 재료를 남겼습니다.");
  } else if (user.produced < user.demand * 0.92) {
    warnings.push("예상 수요보다 생산능력이 부족해 판매 기회를 놓칠 수 있습니다.");
    reasons.push("수요 적합도는 높았지만 제한된 생산량이 실제 판매를 막았습니다.");
  } else {
    reasons.push("수요 예측과 생산량의 간격을 좁혀 납기와 폐기의 균형을 맞췄습니다.");
  }

  if (decisions.marketing >= 8) {
    reasons.push("인지도 투자가 대중형 고객의 선택 확률을 높였습니다.");
  } else if (decisions.marketing <= 4) {
    warnings.push("인지도가 낮아 좋은 제품 적합도가 실제 수요로 연결되지 않을 수 있습니다.");
  }

  if (decisions.rnd >= 8) {
    reasons.push("개인화 R&D가 이야기 반영도와 맞춤형 고객의 선호를 높였습니다.");
  }

  if (decisions.quality >= 88) {
    reasons.push("높은 품질 목표가 수율과 고객 점수를 높이는 대신 단위원가를 올렸습니다.");
  }

  if (user.cash < decisions.reserve) {
    warnings.push("예상 현금이 설정한 안전 완충금 아래로 내려갑니다.");
  }

  if (user.wasteRate > 18) {
    warnings.push("폐기율이 18%를 넘어 지속가능성 점수를 훼손합니다.");
  }

  if (warnings.length === 0) {
    warnings.push("중대한 경고가 없습니다. 공식 제출 전 경쟁사 대응을 한 번 더 확인하세요.");
  }

  return { rows, user, warnings, reasons };
}

function RangeControl({
  label,
  help,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const progress = ((value - min) / (max - min)) * 100;

  return (
    <label className="range-control">
      <span className="control-copy">
        <strong>{label}</strong>
        <small>{help}</small>
      </span>
      <span className="control-value">
        {formatNumber.format(value)}
        <small>{unit}</small>
      </span>
      <input
        aria-label={label + ". " + help}
        aria-valuetext={formatNumber.format(value) + unit}
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        style={{ "--range-progress": progress + "%" } as React.CSSProperties}
        type="range"
        value={value}
      />
    </label>
  );
}

function Metric({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  accent?: string;
}) {
  return (
    <div className={"metric " + (accent ?? "")}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

export default function Home() {
  const [review, setReview] = useState<ReviewState>("pending");
  const [decisions, setDecisions] = useState<Decisions>(initialDecisions);
  const [currentRound, setCurrentRound] = useState(0);
  const [history, setHistory] = useState<RoundRecord[]>([]);
  const [submitted, setSubmitted] = useState<SimulationResult | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [manufacturing, setManufacturing] = useState<ManufacturingState>("locked");
  const manufacturingTimerRef = useRef<number | null>(null);
  const resultsTitleRef = useRef<HTMLHeadingElement>(null);

  const completedBefore = history.filter((record) => record.round > 0 && record.round < currentRound);
  const lastCompleted = completedBefore.at(-1);
  const startingCash = lastCompleted?.user.cash ?? 80;
  const previousWasteRate = lastCompleted?.user.wasteRate ?? 7;
  const profitHistory = completedBefore.map((record) => record.user.profit);
  const preview = useMemo(
    () => simulate(decisions, events[currentRound], startingCash, previousWasteRate, profitHistory),
    [decisions, currentRound, startingCash, previousWasteRate, profitHistory],
  );
  const userRank = preview.rows.findIndex((row) => row.id === "ember") + 1;
  const activeStep = manufacturing === "succeeded"
    ? 4
    : submitted
      ? 3
      : review === "confirmed"
        ? 2
        : review === "contested"
          ? 1
          : 0;

  useEffect(() => {
    return () => {
      if (manufacturingTimerRef.current !== null) {
        window.clearTimeout(manufacturingTimerRef.current);
      }
    };
  }, []);

  const cancelManufacturingTimer = () => {
    if (manufacturingTimerRef.current !== null) {
      window.clearTimeout(manufacturingTimerRef.current);
      manufacturingTimerRef.current = null;
    }
  };

  const setDecision = (key: DecisionKey, value: number) => {
    cancelManufacturingTimer();
    setDecisions((current) => ({ ...current, [key]: value }));
    setDraftSaved(false);
    setSubmitted(null);
    setManufacturing("locked");
  };

  const reviewHypothesis = (state: ReviewState) => {
    cancelManufacturingTimer();
    setReview(state);
    if (state !== "confirmed") {
      setSubmitted(null);
      setManufacturing("locked");
    }
  };

  const submitRound = () => {
    if (review !== "confirmed") return;
    setSubmitted(preview);
    setHistory((records) => [
      ...records.filter((record) => record.round !== currentRound),
      { round: currentRound, user: preview.user },
    ].sort((a, b) => a.round - b.round));
    setManufacturing("idle");
    window.setTimeout(() => {
      resultsTitleRef.current?.focus();
      resultsTitleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const nextRound = () => {
    cancelManufacturingTimer();
    if (currentRound >= events.length - 1) {
      document.getElementById("physical-ai")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setCurrentRound((round) => round + 1);
    setSubmitted(null);
    setDraftSaved(false);
    setManufacturing("locked");
    window.setTimeout(() => {
      document.getElementById("simulation")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const handleManufacturing = () => {
    if (manufacturing === "idle") {
      setManufacturing("approved");
      return;
    }
    if (manufacturing === "approved") {
      cancelManufacturingTimer();
      setManufacturing("running");
      manufacturingTimerRef.current = window.setTimeout(() => {
        setManufacturing("succeeded");
        manufacturingTimerRef.current = null;
      }, 1100);
    }
  };

  const reset = () => {
    cancelManufacturingTimer();
    setReview("pending");
    setDecisions(initialDecisions);
    setCurrentRound(0);
    setHistory([]);
    setSubmitted(null);
    setDraftSaved(false);
    setManufacturing("locked");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const manufactureButton = manufacturing === "idle"
    ? "제품 설계안 사람 승인"
    : manufacturing === "approved"
      ? "모의 액추에이터 실행"
      : manufacturing === "running"
        ? "제어 신호 처리 중…"
        : manufacturing === "succeeded"
          ? "모의 생산 완료"
          : "라운드 제출 후 열림";

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Campfire Foundry 처음으로">
          <span className="brand-mark" aria-hidden="true">CF</span>
          <span>
            <strong>Campfire Foundry</strong>
            <small>증거 기반 경영 시뮬레이션</small>
          </span>
        </a>
        <div className="status-row" aria-label="시뮬레이션 상태">
          <span className="status"><i className="dot green" /> 동의 흐름 모의</span>
          <span className="status"><i className="dot cobalt-dot" /> 사용자 장치 검증</span>
          <span className="status"><i className="dot amber" /> 합성 데이터</span>
          <span className="round">{events[currentRound].label}</span>
          <button className="text-button" onClick={reset}>처음부터</button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-main">
          <p className="eyebrow">EVIDENCE-LED BUSINESS SIMULATION</p>
          <h1>현실의 감각을<br />기업의 판단으로.</h1>
          <p className="hero-copy">
            네 개의 가상 기업이 같은 시장에서 경쟁합니다. 현장 증거를 검토하고
            마케팅·R&amp;D·생산·재무 결정을 연결해 가치사슬 전체를 학습하세요.
          </p>
        </div>
        <aside className="hero-aside">
          <p>이번 학습의 질문</p>
          <strong>“함께한 순간”은 시장에서 어떤 가치가 될까?</strong>
          <span>Palantir형 객체·관계·행동 모델과 Physical AI 기술 지도를 적용한 작동 프로토타입</span>
        </aside>
      </section>

      <nav className="chain" aria-label="증거에서 결과까지의 가치 사슬">
        {chain.map(([number, title, note], index) => (
          <a
            aria-current={index === activeStep ? "step" : undefined}
            className={"chain-step " + (index === activeStep ? "active" : "")}
            href={"#stage-" + number}
            key={number}
          >
            <span>{number}</span>
            <strong>{title}</strong>
            <small>{note}</small>
          </a>
        ))}
      </nav>

      <section className="discovery" id="stage-01" aria-labelledby="discovery-title">
        <div className="section-intro">
          <p className="eyebrow">01 — EVIDENCE &amp; HUMAN REVIEW</p>
          <h2 id="discovery-title">사실과 해석 사이에<br />사람을 둡니다.</h2>
          <p>센서값은 맥락을 보조할 뿐 사람의 상태를 단정하지 않습니다.</p>
        </div>

        <div className="evidence-column">
          <div className="column-heading">
            <span>INPUT / RUN-014</span>
            <strong>동의 흐름을 가정한 합성 근거</strong>
          </div>
          {evidence.map((item) => (
            <article className="evidence-item" key={item.id}>
              <span className="evidence-index">{item.id}</span>
              <div>
                <span className="tag">{item.kind}</span>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </div>
            </article>
          ))}
          <div className="privacy-strip">
            <strong>수집 경계</strong>
            <p>흐린 경로·휴대폰 움직임·사용자가 남긴 메모만 사용합니다.</p>
            <p>정확한 위치는 저장·표시하지 않으며 건강, 피로, 감정, 성격은 추론하지 않습니다.</p>
          </div>
        </div>

        <article className="hypothesis-column" id="stage-02">
          <div className="column-heading">
            <span>HUMAN GATE / H-04</span>
            <strong>AI가 제안한 가설</strong>
          </div>
          <blockquote>
            러닝의 경쟁 기록보다 <em>함께 머문 순간</em>을 물리적인 표식으로
            간직하려는 수요가 있다.
          </blockquote>
          <div className="source-links">
            <span>E1 증언과 연결</span>
            <span>E2 경로 사건과 연결</span>
          </div>
          <div className="review-actions" aria-label="가설 검토">
            <button
              aria-pressed={review === "confirmed"}
              className={review === "confirmed" ? "primary selected" : "primary"}
              onClick={() => reviewHypothesis("confirmed")}
            >
              근거 충분 · 확인
            </button>
            <button
              aria-pressed={review === "contested"}
              className={review === "contested" ? "secondary selected" : "secondary"}
              onClick={() => reviewHypothesis("contested")}
            >
              반박 기록
            </button>
          </div>
          <p className={"review-result " + review} aria-live="polite">
            {review === "pending" && "아직 사람의 검토가 필요합니다."}
            {review === "confirmed" && "확인됨 · 기업 의사결정 게이트가 열렸습니다."}
            {review === "contested" && "반박됨 · E1 또는 E2를 보완한 뒤 다시 검토하세요."}
          </p>
        </article>
      </section>

      <section className="simulation" id="simulation" aria-labelledby="simulation-title">
        <div className="simulation-head" id="stage-03">
          <div>
            <p className="eyebrow">03 — CROSS-FUNCTIONAL DECISIONS</p>
            <h2 id="simulation-title">Ember Labs를 운영하세요.</h2>
          </div>
          <div className="event-summary">
            <span>{events[currentRound].label}</span>
            <strong>{events[currentRound].title}</strong>
            <p>{events[currentRound].description}</p>
          </div>
        </div>

        <div className="sim-grid">
          <aside className="market-panel">
            <div className="market-number">
              <span>시장 규모</span>
              <strong>{formatNumber.format(events[currentRound].marketSize)}</strong>
              <small>잠재 고객</small>
            </div>
            <div className="segment-list">
              <div><span>대중형</span><i style={{ width: events[currentRound].segments[0] + "%" }} /><strong>{events[currentRound].segments[0]}%</strong></div>
              <div><span>개인화형</span><i style={{ width: events[currentRound].segments[1] + "%" }} /><strong>{events[currentRound].segments[1]}%</strong></div>
              <div><span>친환경형</span><i style={{ width: events[currentRound].segments[2] + "%" }} /><strong>{events[currentRound].segments[2]}%</strong></div>
            </div>
            <div className="competitor-list">
              <p>고정 전략 AI 경쟁사</p>
              {competitors.map((team) => (
                <div className="competitor" key={team.id}>
                  <i className={"team-dot " + team.tone} />
                  <span><strong>{team.name}</strong><small>{team.strategy}</small></span>
                  <b>₩{team.decisions.price}k</b>
                </div>
              ))}
            </div>
            <p className="model-note">모든 기업은 같은 사건 조건을 받으며, 경쟁사는 라운드 내 전략을 바꾸지 않습니다.</p>
          </aside>

          <div className={"decision-board " + (review !== "confirmed" ? "is-locked" : "")}>
            {review !== "confirmed" && (
              <div className="decision-lock">
                <span>HUMAN GATE</span>
                <strong>가설을 확인해야 결정할 수 있습니다.</strong>
                <a href="#stage-02">검토 영역으로 이동</a>
              </div>
            )}
            <section className="department">
              <header><span>01</span><div><strong>마케팅</strong><small>가격과 시장 인지도</small></div></header>
              <RangeControl label="판매 가격" help="낮으면 수요, 높으면 단위 마진이 증가" value={decisions.price} min={20} max={42} step={1} unit="천원" disabled={review !== "confirmed"} onChange={(value) => setDecision("price", value)} />
              <RangeControl label="캠페인 예산" help="시장 인지도를 높이지만 현금을 사용" value={decisions.marketing} min={2} max={12} step={0.5} unit="백만원" disabled={review !== "confirmed"} onChange={(value) => setDecision("marketing", value)} />
            </section>
            <section className="department">
              <header><span>02</span><div><strong>R&amp;D / 제품</strong><small>이야기를 제품 사양으로</small></div></header>
              <RangeControl label="개인화 R&D" help="Route Tag의 이야기 반영도와 원가에 영향" value={decisions.rnd} min={2} max={12} step={0.5} unit="백만원" disabled={review !== "confirmed"} onChange={(value) => setDecision("rnd", value)} />
              <RangeControl label="품질 목표" help="수율과 고객 평가를 높이지만 재료비 증가" value={decisions.quality} min={55} max={96} step={1} unit="점" disabled={review !== "confirmed"} onChange={(value) => setDecision("quality", value)} />
            </section>
            <section className="department">
              <header><span>03</span><div><strong>생산</strong><small>수요 예측과 실제 공급</small></div></header>
              <RangeControl label="생산 계획" help="부족하면 품절, 과하면 폐기 위험" value={decisions.production} min={500} max={1700} step={50} unit="개" disabled={review !== "confirmed"} onChange={(value) => setDecision("production", value)} />
              <div className="department-callout">
                <span>사건 반영 가용량</span>
                <strong>{formatNumber.format(Math.round(decisions.production * events[currentRound].capacityMultiplier))}개</strong>
                <small>{events[currentRound].capacityMultiplier < 1 ? "공급 충격으로 계획 대비 감소" : "현재 설비 제약 없음"}</small>
              </div>
            </section>
            <section className="department">
              <header><span>04</span><div><strong>재무 · 영향</strong><small>생존 가능성과 균형 점수</small></div></header>
              <RangeControl label="현금 완충 목표" help="예상 현금이 이 선보다 낮으면 경고" value={decisions.reserve} min={25} max={75} step={5} unit="백만원" disabled={review !== "confirmed"} onChange={(value) => setDecision("reserve", value)} />
              <div className={"department-callout " + (preview.user.cash < decisions.reserve ? "danger" : "safe")}>
                <span>라운드 후 예상 현금</span>
                <strong>₩{formatNumber.format(preview.user.cash)}M</strong>
                <small>{preview.user.cash < decisions.reserve ? "완충 목표 미달" : "완충 목표 충족"}</small>
              </div>
            </section>
          </div>
        </div>

        <div className="forecast-strip" aria-live="polite">
          <Metric label="예상 수요" value={formatNumber.format(Math.round(preview.user.demand)) + "개"} note="모든 기업의 상대 매력도 반영" />
          <Metric label="예상 매출" value={"₩" + formatNumber.format(preview.user.revenue) + "M"} note="가격 × 실제 판매 가능량" />
          <Metric label="예상 이익" value={"₩" + formatNumber.format(preview.user.profit) + "M"} note="마케팅·R&D·폐기 비용 포함" accent={preview.user.profit >= 0 ? "positive" : "negative"} />
          <Metric label="시장점유율" value={formatNumber.format(preview.user.marketShare) + "%"} note={"현재 예측 순위 " + userRank + "위 / 4"} />
          <Metric label="균형 점수" value={formatNumber.format(preview.user.balancedScore)} note="이익·납기·이야기·폐기·고객" accent="cobalt" />
        </div>

        <div className="decision-footer">
          <div className="warning-list">
            <span>제출 전 진단</span>
            {preview.warnings.slice(0, 2).map((warning) => <p key={warning}>• {warning}</p>)}
          </div>
          <div className="submit-actions">
            <p aria-live="polite">{draftSaved ? "현재 입력을 초안 상태로 표시했습니다." : "초안은 자유롭게 바꿀 수 있습니다."}</p>
            <button className="secondary" disabled={review !== "confirmed"} onClick={() => setDraftSaved(true)}>초안 표시</button>
            <button className="primary submit" disabled={review !== "confirmed"} onClick={submitRound}>공식 결정 제출</button>
          </div>
        </div>
      </section>

      <section className={"results " + (submitted ? "visible" : "")} id="results" aria-labelledby="results-title" aria-live="polite">
        <div className="results-head">
          <div>
            <p className="eyebrow">ROUND REPORT</p>
            <h2 id="results-title" ref={resultsTitleRef} tabIndex={-1}>{submitted ? events[currentRound].label + " 결과" : "공식 제출 후 경쟁 결과가 열립니다."}</h2>
          </div>
          {submitted && <span className="processed">ROUND PROCESSED</span>}
        </div>

        {submitted ? (
          <>
            <div className="outcome-grid">
              <div className="outcome-summary">
                <span>EMBER LABS</span>
                <strong>{submitted.rows.findIndex((row) => row.id === "ember") + 1}<small>위 / 4</small></strong>
                <p>균형 점수 {formatNumber.format(submitted.user.balancedScore)} · 기업가치 ₩{formatNumber.format(submitted.user.enterpriseValue)}M</p>
              </div>
              <Metric label="판매량" value={formatNumber.format(submitted.user.sold) + "개"} note={"수요 " + formatNumber.format(Math.round(submitted.user.demand)) + "개"} />
              <Metric label="라운드 이익" value={"₩" + formatNumber.format(submitted.user.profit) + "M"} note={"현금 ₩" + formatNumber.format(submitted.user.cash) + "M"} accent={submitted.user.profit >= 0 ? "positive" : "negative"} />
              <Metric label="고객 점수" value={formatNumber.format(submitted.user.customerScore)} note={"납기 충족 " + formatNumber.format(submitted.user.onTime) + "%"} />
              <Metric label="폐기율" value={formatNumber.format(submitted.user.wasteRate) + "%"} note={formatNumber.format(submitted.user.waste) + "개 상당"} accent={submitted.user.wasteRate <= 15 ? "positive" : "negative"} />
            </div>

            <div className="report-grid">
              <div className="leaderboard-wrap">
                <div className="report-title"><span>경쟁 결과</span><small>균형 점수 기준</small></div>
                <div className="leaderboard" role="table" aria-label="기업 순위">
                  <div className="table-row table-head" role="row">
                    <span role="columnheader">순위 / 기업</span><span role="columnheader">전략</span><span role="columnheader">점유율</span><span role="columnheader">이익</span><span role="columnheader">점수</span>
                  </div>
                  {submitted.rows.map((row, index) => (
                    <div className={"table-row " + (row.id === "ember" ? "my-team" : "")} role="row" key={row.id}>
                      <span role="cell"><i className={"team-dot " + row.tone} />{index + 1}. {row.name}</span>
                      <span role="cell">{row.strategy}</span>
                      <span role="cell">{formatNumber.format(row.marketShare)}%</span>
                      <span role="cell">₩{formatNumber.format(row.profit)}M</span>
                      <strong role="cell">{formatNumber.format(row.balancedScore)}</strong>
                    </div>
                  ))}
                </div>
              </div>
              <aside className="debrief">
                <div className="report-title"><span>자동 디브리프</span><small>결정 → 결과의 이유</small></div>
                {submitted.reasons.slice(0, 3).map((reason, index) => (
                  <div className="reason" key={reason}><span>0{index + 1}</span><p>{reason}</p></div>
                ))}
                <button className="next-round" onClick={nextRound}>
                  {currentRound < events.length - 1 ? "다음 라운드 준비 →" : "최종 모의 제조로 이동 →"}
                </button>
              </aside>
            </div>
          </>
        ) : (
          <div className="empty-report">
            <span aria-hidden="true">DRAFT</span>
            <p>초안 수치는 즉시 계산되지만, 경쟁사의 공식 결과와 디브리프는 제출 이후에만 확정됩니다.</p>
          </div>
        )}
      </section>

      <section className="physical-ai" id="physical-ai" aria-labelledby="physical-title">
        <div className="physical-heading" id="stage-04">
          <div>
            <p className="eyebrow">04 — PHYSICAL AI SANDBOX</p>
            <h2 id="physical-title">AI + 센서 + 하드웨어 + 제어</h2>
            <p>현실 장비를 연결하기 전, 승인과 제어 흐름을 격리된 모의 환경에서 검증합니다.</p>
          </div>
          <span className="sandbox-badge"><i /> 실제 장비 미연결</span>
        </div>

        <div className="physical-flow">
          <article>
            <span>01 / SENSOR</span>
            <strong>센서 기술</strong>
            <p>흐린 GPS 구간과 휴대폰 움직임의 합성 샘플</p>
            <small className="ready">INPUT READY</small>
          </article>
          <article>
            <span>02 / AI</span>
            <strong>AI 알고리즘</strong>
            <p>증언·경로 관계에서 제품 가설 H-04 제안</p>
            <small className={review === "confirmed" ? "ready" : "waiting"}>{review === "confirmed" ? "ACCEPTED FOR SIMULATION" : "WAITING REVIEW"}</small>
          </article>
          <article>
            <span>03 / CONTROL</span>
            <strong>제어 시스템</strong>
            <p>품질 {decisions.quality}점 · 1차 샘플 약 {Math.round(18 + decisions.quality * 0.25 + decisions.rnd * 1.2)}분</p>
            <small className={manufacturing === "approved" || manufacturing === "running" || manufacturing === "succeeded" ? "ready" : "waiting"}>HUMAN GATE</small>
          </article>
          <article>
            <span>04 / IOT</span>
            <strong>통신 인프라</strong>
            <p>ROS 2 Action 계약 또는 로컬 serial gateway로 교체 가능한 모의 버스</p>
            <small className="ready">ISOLATED</small>
          </article>
          <article>
            <span>05 / ACTUATOR</span>
            <strong>OpenCat 어댑터</strong>
            <p>Bittle·Nybble 동작과 제조 장치 출력을 동일한 승인 계약 아래 모의 실행</p>
            <small className={manufacturing === "succeeded" ? "ready" : manufacturing === "running" ? "running" : "waiting"}>
              {manufacturing === "succeeded" ? "SUCCEEDED" : manufacturing === "running" ? "RUNNING" : "SIMULATION ONLY"}
            </small>
          </article>
        </div>

        <div className="manufacturing-console">
          <div className="product-spec">
            <span className="route-mark" aria-hidden="true"><i /><i /><i /></span>
            <div>
              <span>PRODUCT SPEC / PS-12</span>
              <strong>Campfire Route Tag</strong>
            <p>합성 기록에서 체류로 표시된 7분 구간을 추상 선으로 각인 · 정확한 경로는 제품에 포함하지 않음</p>
            </div>
          </div>
          <div className="run-states" aria-label="모의 생산 상태">
            {["REQUESTED", "DISPATCHED", "RUNNING", "SUCCEEDED"].map((state, index) => {
              const level = manufacturing === "locked" ? -1 : manufacturing === "idle" ? 0 : manufacturing === "approved" ? 1 : manufacturing === "running" ? 2 : 3;
              return <span className={level >= index ? "active" : ""} key={state}><i />{state}</span>;
            })}
          </div>
          <button
            className="manufacture-button"
            disabled={manufacturing === "locked" || manufacturing === "running" || manufacturing === "succeeded"}
            onClick={handleManufacturing}
          >
            {manufactureButton}
          </button>
          <p className="console-note" aria-live="polite">
            {manufacturing === "locked" && "공식 라운드 결과에서 승인할 제품 사양을 먼저 확정하세요."}
            {manufacturing === "idle" && "AI는 실행할 수 없습니다. 사람이 제품 사양과 제어 정책을 승인해야 합니다."}
            {manufacturing === "approved" && "사람 승인 완료 · 격리된 모의 제어 신호만 보낼 수 있습니다."}
            {manufacturing === "running" && "모의 액추에이터가 제어 정책을 실행하고 있습니다."}
            {manufacturing === "succeeded" && "합성 결과 · 49분 · 결함 1건 · 사용자 평가 4.5/5. 원인으로 단정하지 않습니다."}
          </p>
        </div>

        <div className="adapter-contract">
          <div>
            <span>OPERATOR EVIDENCE</span>
            <strong>장치 연결 검증 완료 · 현재 웹 세션은 미연결</strong>
            <p>사용자 제공 검증과 공개 문서 근거를 분리해 기록합니다.</p>
          </div>
          <div>
            <span>MOCK OPENCAT ADAPTER</span>
            <strong>SIMULATE / BIBOARD</strong>
            <p>현재 세대 Bittle X·Nybble Q는 OpenCatESP32 프로필, 구형 NyBoard는 원 저장소 프로필로 분기합니다.</p>
          </div>
          <div>
            <span>ALLOWLISTED INTENTS</span>
            <strong>SIT · STAND · REST · BEEP</strong>
            <p>AI가 raw serial, 관절각, 보행·점프 명령을 직접 만들거나 보내지 못합니다.</p>
          </div>
          <a href="https://github.com/PetoiCamp/OpenCat-Quadruped-Robot" rel="noreferrer" target="_blank">
            OpenCat 원본 저장소 ↗
          </a>
        </div>
      </section>

      <section className="research-atlas" id="research" aria-labelledby="research-title">
        <div className="atlas-head">
          <div>
            <p className="eyebrow">DEEP RESEARCH — AWESOME PHYSICAL AI</p>
            <h2 id="research-title">수백 개 프로젝트를<br />일곱 역할로 묶습니다.</h2>
          </div>
          <div className="atlas-note">
            <strong>조사 결론</strong>
            <p>awesome-physical-ai는 실행 패키지가 아니라 발견용 색인입니다. 모델을 서로 직접 연결하는 대신 공통 Observation, Proposal, Action, Outcome 객체를 주고받게 합니다.</p>
          </div>
        </div>

        <div className="atlas-grid">
          {[
            ["01", "관찰", "DINOv2 · SAM · 센서 플러그인", "센서값을 원본 증거와 파생 특징으로 분리"],
            ["02", "세계 예측", "V-JEPA 2 · World Models", "다음 상태 후보를 예측하되 사실로 승격하지 않음"],
            ["03", "추론·계획", "Modular VLA · SayCan 계열", "자연어 목표를 허용된 기술과 제약으로 변환"],
            ["04", "행동 정책", "LeRobot · SmolVLA · OpenVLA", "모델 출력을 장치 독립 ActionProposal로 정규화"],
            ["05", "시뮬레이션", "MuJoCo · Isaac Lab", "동일한 행동 계약을 디지털 트윈에서 먼저 평가"],
            ["06", "오케스트레이션", "ROS 2 Action · Lifecycle", "피드백·취소·상태 전이를 갖는 장시간 작업 실행"],
            ["07", "물리 실행", "OpenCat · 장치별 Adapter", "승인된 의도만 allowlist 명령으로 변환"],
          ].map(([number, title, tools, description]) => (
            <article className="atlas-layer" key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <strong>{tools}</strong>
              <p>{description}</p>
            </article>
          ))}
        </div>

        <div className="safety-spine">
          <span>SAFETY SPINE</span>
          <strong>동의 → 출처 → 불확실성 → 시뮬레이션 → 사람 승인 → allowlist → 취소 → 결과 감사</strong>
          <p>RoboPAIR가 보여 준 것처럼 언어 모델의 안전장치만으로는 물리 행동을 보호할 수 없습니다. 의미·물리·운영 안전을 여러 층으로 겹칩니다.</p>
        </div>

        <div className="atlas-verdict">
          <div>
            <span>지금 적용</span>
            <strong>Ontology + Human Gate + MockOpenCatAdapter</strong>
          </div>
          <div>
            <span>다음 연결점</span>
            <strong>LeRobot Robot plugin + ROS 2 Action</strong>
          </div>
          <div>
            <span>실험 트랙</span>
            <strong>V-JEPA 2 / SmolVLA + MuJoCo·Isaac Lab</strong>
          </div>
          <div className="audit-warning">
            <span>색인 품질 경고</span>
            <strong>현재 README에서 placeholder arXiv URL 27개 발견</strong>
          </div>
        </div>
        <div className="atlas-sources">
          <span>직접 확인한 공식 근거</span>
          <a href="https://raw.githubusercontent.com/keon/awesome-physical-ai/main/README.md" rel="noreferrer" target="_blank">Awesome Physical AI README</a>
          <a href="https://huggingface.co/docs/lerobot/main/en/integrate_hardware" rel="noreferrer" target="_blank">LeRobot Hardware Interface</a>
          <a href="https://docs.ros.org/en/ros2_documentation/rolling/Concepts/Basic/Interfaces-Topics-Services-Actions.html" rel="noreferrer" target="_blank">ROS 2 Interfaces</a>
          <a href="https://mujoco.readthedocs.io/en/stable/overview.html" rel="noreferrer" target="_blank">MuJoCo</a>
          <a href="https://isaac-sim.github.io/IsaacLab/main/" rel="noreferrer" target="_blank">Isaac Lab</a>
          <a href="https://github.com/facebookresearch/vjepa2" rel="noreferrer" target="_blank">V-JEPA 2</a>
          <a href="https://robopair.org/" rel="noreferrer" target="_blank">RoboPAIR</a>
        </div>
        <p className="atlas-disclaimer">장치 호환성은 사용자 검증 근거를 따릅니다. 위 공개 색인의 링크·연도·성능 주장은 실제 채택 전 각 공식 논문과 저장소에서 다시 확인합니다.</p>
      </section>

      <section className="ontology" id="stage-05" aria-labelledby="ontology-title">
        <div className="ontology-intro">
          <p className="eyebrow">05 — ONTOLOGY LEDGER</p>
          <h2 id="ontology-title">결과에서 근거까지<br />거꾸로 추적됩니다.</h2>
          <p>데이터 파일이 아니라 객체, 관계, 허용된 행동의 기록으로 운영합니다.</p>
        </div>
        <div className="object-thread">
          {[
            ["EvidenceSession", "RUN-014", "관찰됨", "Evidence"],
            ["Testimony", "T-03", "세션에 포함", "Evidence"],
            ["Hypothesis", "H-04", review === "confirmed" ? "사람이 확인" : "검토 대기", "Reasoning"],
            ["DecisionSet", "D-R" + currentRound, submitted ? "공식 제출" : "초안", "Business"],
            ["ProductSpec", "PS-12", manufacturing === "locked" ? "잠김" : "결정에서 생성", "Physical"],
            ["ProductionRun", "PR-MOCK-01", manufacturing.toUpperCase(), "Physical"],
            ["Outcome", "O-01", manufacturing === "succeeded" ? "학습에 반영" : "대기", "Learning"],
          ].map(([type, id, relation, domain], index) => (
            <div className="object-row" key={type}>
              <span className="object-order">{String(index + 1).padStart(2, "0")}</span>
              <div><small>{domain}</small><strong>{type}</strong></div>
              <code>{id}</code>
              <span className="relation">{relation}</span>
            </div>
          ))}
        </div>
      </section>

      <footer>
        <div>
          <strong>Campfire Foundry</strong>
          <p>교육용 합성 시뮬레이션 · 실제 사람, 위치, 결제, 제조 장비와 연결되지 않습니다.</p>
        </div>
        <p className="source-note">
          연구 기반:
          <a href="https://github.com/keon/awesome-physical-ai" rel="noreferrer" target="_blank"> Awesome Physical AI</a>
          <span> · </span>
          교차기능 학습:
          <a href="https://www.capsim.com/product-catalog/business-simulations/capstone" rel="noreferrer" target="_blank"> Capsim Capstone</a>
          <span> · </span>
          <a href="https://www.capsim.com/product-catalog/business-simulations/capsimcore" rel="noreferrer" target="_blank">CapsimCore</a>
        </p>
      </footer>
    </main>
  );
}
