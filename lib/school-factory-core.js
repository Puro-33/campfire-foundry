// Private-project reuse: adapted from Documents/school-factory-ai-sim/simulation-core.cjs.
// The source project has no declared license; keep this deployment and repository private.
'use strict';

const STEP_DAYS = 0.25;
const START_DATE = new Date(Date.UTC(2028, 2, 2));

const POLICY_SPECS = Object.freeze({
  'school.curriculum': { label: '현장 연계 교육과정', min: 20, max: 100, initial: 64 },
  'school.teacherTraining': { label: '교사·강사 연수', min: 0, max: 100, initial: 58 },
  'school.labInvestment': { label: '실습 설비 투자', min: 0, max: 100, initial: 52 },
  'school.studentSupport': { label: '학생 지원', min: 40, max: 100, initial: 74 },
  'bridge.internships': { label: '안전한 현장실습 수용력', min: 10, max: 90, initial: 46 },
  'bridge.feedback': { label: '직무 수요 피드백', min: 10, max: 100, initial: 64 },
  'factory.productionTarget': { label: '생산 목표', min: 35, max: 100, initial: 68 },
  'factory.maintenance': { label: '예방정비', min: 20, max: 100, initial: 62 },
  'factory.workforceTraining': { label: '현장 인력 교육', min: 0, max: 100, initial: 56 },
  'factory.inventoryBuffer': { label: '원자재 재고 완충', min: 10, max: 90, initial: 48 },
  'factory.overtime': { label: '초과근무', min: 0, max: 60, initial: 18 }
});

const EVENT_DEFINITIONS = Object.freeze({
  demand: { name: '수요 급증', duration: 45, description: '주문 수요가 25% 증가합니다.' },
  supply: { name: '공급 지연', duration: 35, description: '핵심 자재 조달 신뢰도가 40% 낮아집니다.' },
  machine: { name: '설비 이상', duration: 25, description: '설비 건전성과 생산능력이 낮아집니다.' },
  instructor: { name: '교사 공백', duration: 30, description: '실습 교육 전달력이 일시적으로 낮아집니다.' }
});

const SCENARIOS = Object.freeze({
  balanced: '균형 운영',
  demand: '수요 충격',
  skills: '역량 부족'
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function approach(current, target, tauDays, dt) {
  return current + (target - current) * (1 - Math.exp(-dt / tauDays));
}

function round(value, digits) {
  const factor = 10 ** (digits || 0);
  return Math.round(value * factor) / factor;
}

function initialPolicies() {
  const result = {};
  Object.entries(POLICY_SPECS).forEach(function (entry) {
    result[entry[0]] = entry[1].initial;
  });
  return result;
}

function initialState() {
  return {
    teacherCapacity: 70,
    labCondition: 74,
    readiness: 67,
    wellbeing: 84,
    schoolCash: 420,
    labUtilization: 61,
    workforceSkill: 66,
    machineHealth: 82,
    qualityCapability: 74,
    safety: 91,
    inventory: 61,
    throughput: 72,
    defectRate: 3.1,
    goodOutput: 69.8,
    factoryCash: 920,
    fulfillment: 92,
    backlog: 118,
    trust: 63,
    requiredSkill: 76,
    demand: 74,
    connection: 78
  };
}

function initialStats(state, derived) {
  const guardKeys = [
    'student',
    'safety',
    'schoolLiquidity',
    'factoryLiquidity'
  ];
  const guardMap = {};
  const episodeMap = {};
  const currentEpisodeMap = {};
  const longestEpisodeMap = {};
  guardKeys.forEach(function (key) {
    guardMap[key] = 0;
    episodeMap[key] = 0;
    currentEpisodeMap[key] = 0;
    longestEpisodeMap[key] = 0;
  });

  return {
    elapsedDays: 0,
    startCash: {
      school: state.schoolCash,
      factory: state.factoryCash
    },
    finance: {
      schoolRevenue: 0,
      schoolCost: 0,
      educationInvestment: 0,
      studentSupportCost: 0,
      factoryRevenue: 0,
      factoryCost: 0,
      factoryPolicyInvestment: 0,
      schoolLiquiditySupport: 0,
      factoryLiquiditySupport: 0,
      schoolCeilingSweep: 0,
      factoryCeilingSweep: 0
    },
    operations: {
      producedUnits: 0,
      goodUnits: 0,
      defectUnits: 0,
      shippedUnits: 0,
      demandUnits: 0,
      servedDemandUnits: 0
    },
    weighted: {
      connection: 0,
      readiness: 0,
      skillGap: 0,
      wellbeing: 0,
      safety: 0,
      machineHealth: 0,
      backlog: 0
    },
    extremes: {
      minimumWellbeing: state.wellbeing,
      minimumSafety: state.safety,
      minimumMachineHealth: state.machineHealth,
      minimumSchoolCash: state.schoolCash,
      minimumFactoryCash: state.factoryCash,
      maximumBacklog: state.backlog,
      maximumSkillGap: derived.skillGap
    },
    guardDays: guardMap,
    guardEpisodes: episodeMap,
    currentGuardEpisodeDays: currentEpisodeMap,
    longestGuardEpisodeDays: longestEpisodeMap,
    criticalDays: {
      studentWellbeing: 0,
      industrialSafety: 0,
      schoolCashZero: 0,
      factoryCashZero: 0
    },
    criticalAnyDays: 0,
    constrainedPolicyDays: 0
  };
}

class Simulation {
  constructor(scenario) {
    this.reset(scenario || 'balanced');
  }

  reset(scenario) {
    if (!SCENARIOS[scenario]) {
      throw new Error('알 수 없는 시나리오: ' + scenario);
    }
    this.scenario = scenario;
    this.day = 0;
    this.pendingDays = 0;
    this.policy = initialPolicies();
    this.state = initialState();
    this.events = [];
    this.logs = [];
    this.history = [];
    this.nextEventId = 1;
    this.recoveries = [];
    this.guards = {
      student: false,
      safety: false,
      schoolLiquidity: false,
      factoryLiquidity: false
    };

    if (scenario === 'demand') {
      this.policy['factory.productionTarget'] = 78;
      this.policy['factory.inventoryBuffer'] = 54;
      this.policy['factory.maintenance'] = 66;
      this.state.backlog = 165;
      this.inject('demand', true);
    }
    if (scenario === 'skills') {
      this.policy['school.curriculum'] = 72;
      this.policy['school.teacherTraining'] = 70;
      this.policy['factory.workforceTraining'] = 68;
      this.policy['bridge.feedback'] = 76;
      this.state.readiness = 53;
      this.state.workforceSkill = 54;
      this.state.trust = 46;
      this.state.requiredSkill = 82;
    }

    this.derived = this.computeDerived();
    this.state.connection = this.derived.connection;
    this.stats = initialStats(this.state, this.derived);
    this.recordHistory();
    this.addLog('시나리오 시작', SCENARIOS[scenario] + ' 조건을 불러왔습니다.', 'info');
    return this.snapshot();
  }

  setPolicy(key, value) {
    const spec = POLICY_SPECS[key];
    if (!spec) {
      throw new Error('알 수 없는 정책 키: ' + key);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error('정책 값은 숫자여야 합니다.');
    }
    if (numeric < spec.min || numeric > spec.max) {
      throw new Error(spec.label + ' 범위는 ' + spec.min + '~' + spec.max + '입니다.');
    }
    this.policy[key] = numeric;
    this.addLog('정책 변경', spec.label + ' = ' + numeric + '%', 'policy');
    return numeric;
  }

  inject(type, silent) {
    const definition = EVENT_DEFINITIONS[type];
    if (!definition) {
      throw new Error('알 수 없는 사건: ' + type);
    }
    const existing = this.events.find(function (event) {
      return event.type === type;
    });
    if (existing) {
      existing.remaining = Math.min(
        existing.duration * 1.5,
        existing.remaining + definition.duration * 0.5
      );
      const recovery = this.recoveries.find(function (item) {
        return item.eventId === existing.id;
      });
      if (recovery) {
        recovery.endDay = null;
        recovery.recoveredDay = null;
        recovery.stableDays = 0;
      }
      if (!silent) {
        this.addLog('사건 연장', definition.name + ' 영향 기간이 연장됐습니다.', 'event');
      }
      return existing;
    }

    const event = {
      id: this.nextEventId,
      type: type,
      name: definition.name,
      duration: definition.duration,
      remaining: definition.duration,
      recoveryId: this.nextEventId
    };
    this.recoveries.push({
      eventId: event.id,
      type: type,
      name: definition.name,
      startDay: this.day,
      endDay: null,
      recoveredDay: null,
      stableDays: 0,
      baseline: {
        fulfillment: this.state.fulfillment,
        backlog: this.state.backlog,
        inventory: this.state.inventory,
        machineHealth: this.state.machineHealth,
        safety: this.state.safety,
        teacherCapacity: this.state.teacherCapacity,
        wellbeing: this.state.wellbeing,
        skillGap: Math.max(0, this.state.requiredSkill - this.state.readiness)
      }
    });
    this.nextEventId += 1;
    this.events.push(event);
    if (type === 'machine') {
      this.state.machineHealth = clamp(this.state.machineHealth - 12, 20, 100);
    } else if (type === 'supply') {
      this.state.inventory = clamp(this.state.inventory - 9, 0, 100);
    } else if (type === 'instructor') {
      this.state.teacherCapacity = clamp(this.state.teacherCapacity - 7, 20, 100);
    } else if (type === 'demand') {
      this.state.backlog = clamp(this.state.backlog + 28, 0, 520);
    }
    if (!silent) {
      this.addLog('사건 발생', definition.name + ': ' + definition.description, 'event');
    }
    return event;
  }

  advance(days) {
    const numeric = Number(days);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new Error('진행 일수는 0 이상의 숫자여야 합니다.');
    }
    this.pendingDays += numeric;
    let steps = 0;
    while (this.pendingDays + 1e-10 >= STEP_DAYS) {
      this.step(STEP_DAYS);
      this.pendingDays -= STEP_DAYS;
      steps += 1;
      if (steps > 2000000) {
        throw new Error('한 번에 진행할 수 있는 범위를 초과했습니다.');
      }
    }
    return this.snapshot();
  }

  eventModifiers() {
    const modifiers = {
      demandBoost: 0,
      supplyReliability: 0.96,
      machinePenalty: 0,
      educationPenalty: 0,
      stressPenalty: 0
    };
    this.events.forEach(function (event) {
      const intensity = clamp(event.remaining / Math.min(10, event.duration), 0.35, 1);
      if (event.type === 'demand') {
        modifiers.demandBoost += 25 * intensity;
      } else if (event.type === 'supply') {
        modifiers.supplyReliability -= 0.36 * intensity;
      } else if (event.type === 'machine') {
        modifiers.machinePenalty += 15 * intensity;
      } else if (event.type === 'instructor') {
        modifiers.educationPenalty += 18 * intensity;
        modifiers.stressPenalty += 5 * intensity;
      }
    });
    modifiers.supplyReliability = clamp(modifiers.supplyReliability, 0.45, 1);
    return modifiers;
  }

  effectivePolicy() {
    const p = Object.assign({}, this.policy);
    const s = this.state;
    const requestedSafety =
      83 +
      p['factory.maintenance'] * 0.1 +
      p['factory.workforceTraining'] * 0.08 -
      p['factory.overtime'] * 0.23 -
      Math.max(0, p['factory.productionTarget'] - 75) * 0.12;
    const safetyRisk =
      requestedSafety < 82 ||
      this.guards.safety ||
      s.safety < 82 ||
      s.machineHealth < 62;
    const studentRisk = this.guards.student || s.wellbeing < 72;
    const schoolLiquidity = clamp(s.schoolCash / 180, 0.15, 1);
    const factoryLiquidity = clamp(s.factoryCash / 250, 0.35, 1);

    p['school.curriculum'] =
      30 + Math.max(0, p['school.curriculum'] - 30) * schoolLiquidity;
    p['school.teacherTraining'] *= schoolLiquidity;
    p['school.labInvestment'] *= schoolLiquidity;
    p['factory.productionTarget'] =
      35 + Math.max(0, p['factory.productionTarget'] - 35) * factoryLiquidity;
    p['factory.inventoryBuffer'] =
      10 + Math.max(0, p['factory.inventoryBuffer'] - 10) * factoryLiquidity;

    if (studentRisk) {
      p['school.studentSupport'] = Math.max(p['school.studentSupport'], 76);
      p['bridge.internships'] = Math.min(p['bridge.internships'], 35);
    }
    if (s.wellbeing < 65) {
      p['school.studentSupport'] = 100;
      p['bridge.internships'] = 0;
    }
    if (safetyRisk) {
      p['factory.overtime'] = 0;
      p['factory.productionTarget'] = Math.min(p['factory.productionTarget'], 75);
      p['factory.maintenance'] = Math.max(p['factory.maintenance'], 72);
    }
    if (s.safety < 75 || s.machineHealth < 50) {
      p['factory.productionTarget'] = Math.min(p['factory.productionTarget'], 55);
      p['factory.maintenance'] = Math.max(p['factory.maintenance'], 88);
      p['bridge.internships'] = 0;
    }

    const supervision = clamp(
      30 +
      p['factory.workforceTraining'] * 0.35 +
      p['factory.maintenance'] * 0.2,
      20,
      90
    );
    p['bridge.internships'] = Math.min(
      p['bridge.internships'],
      supervision,
      clamp((s.safety - 65) * 4, 0, 100),
      clamp((s.wellbeing - 55) * 4, 0, 100)
    );
    return p;
  }

  step(dt) {
    const p = this.effectivePolicy();
    const s = this.state;
    const modifiers = this.eventModifiers();
    const seasonalDemand = 72 + 6 * Math.sin((this.day + 12) / 44);
    s.demand = approach(s.demand, seasonalDemand + modifiers.demandBoost, 4, dt);
    s.requiredSkill = approach(
      s.requiredSkill,
      clamp(63 + p['factory.productionTarget'] * 0.12 +
        Math.max(0, s.demand - 65) * 0.14, 60, 93),
      15,
      dt
    );
    s.teacherCapacity = approach(
      s.teacherCapacity,
      clamp(49 + p['school.teacherTraining'] * 0.42 +
        p['bridge.feedback'] * 0.08 - modifiers.educationPenalty, 30, 96),
      55,
      dt
    );
    s.labUtilization = approach(
      s.labUtilization,
      clamp(24 + p['school.curriculum'] * 0.38 +
        p['bridge.internships'] * 0.2 + p['school.labInvestment'] * 0.13, 20, 98),
      20,
      dt
    );
    s.labCondition = approach(
      s.labCondition,
      clamp(69 + p['school.labInvestment'] * 0.25 -
        Math.max(0, s.labUtilization - 75) * 0.25, 35, 98),
      80,
      dt
    );

    let wellbeingTarget = clamp(
      78 + p['school.studentSupport'] * 0.15 -
      p['bridge.internships'] * 0.08 -
      Math.max(0, p['school.curriculum'] - 76) * 0.12 -
      modifiers.stressPenalty,
      52,
      96
    );
    if (s.wellbeing < 72) {
      wellbeingTarget = Math.max(wellbeingTarget, 76);
    }
    if (s.wellbeing < 65) {
      wellbeingTarget = Math.max(wellbeingTarget, 84);
    }
    s.wellbeing = approach(s.wellbeing, wellbeingTarget, 24, dt);
    s.readiness = approach(
      s.readiness,
      clamp(8 + p['school.curriculum'] * 0.31 +
        s.teacherCapacity * 0.2 + s.labCondition * 0.14 +
        s.wellbeing * 0.08 + p['bridge.internships'] * 0.08 +
        p['bridge.feedback'] * 0.1 - modifiers.educationPenalty * 0.18, 30, 96),
      55,
      dt
    );
    s.trust = approach(
      s.trust,
      clamp(25 + p['bridge.feedback'] * 0.31 +
        p['bridge.internships'] * 0.16 + s.fulfillment * 0.1 +
        s.wellbeing * 0.08, 25, 98),
      70,
      dt
    );
    s.workforceSkill = approach(
      s.workforceSkill,
      clamp(20 + p['factory.workforceTraining'] * 0.3 +
        s.readiness * 0.25 + p['bridge.feedback'] * 0.13 +
        s.trust * 0.12, 35, 96),
      70,
      dt
    );
    s.machineHealth = approach(
      s.machineHealth,
      clamp(83 + p['factory.maintenance'] * 0.28 -
        p['factory.productionTarget'] * 0.16 -
        p['factory.overtime'] * 0.23 - modifiers.machinePenalty, 28, 99),
      25,
      dt
    );
    s.inventory = approach(
      s.inventory,
      clamp((35 + p['factory.inventoryBuffer'] * 0.8 -
        p['factory.productionTarget'] * 0.16) *
        modifiers.supplyReliability, 8, 96),
      13,
      dt
    );
    s.qualityCapability = approach(
      s.qualityCapability,
      clamp(30 + s.workforceSkill * 0.25 +
        p['factory.maintenance'] * 0.24 + s.readiness * 0.2 -
        p['factory.overtime'] * 0.15, 35, 98),
      36,
      dt
    );

    let safetyTarget = clamp(
      83 + p['factory.maintenance'] * 0.1 +
      p['factory.workforceTraining'] * 0.08 -
      p['factory.overtime'] * 0.23 -
      Math.max(0, p['factory.productionTarget'] - 75) * 0.12 -
      modifiers.machinePenalty * 0.45,
      40,
      99
    );
    if (s.safety < 82) {
      safetyTarget = Math.max(safetyTarget, 86);
    }
    s.safety = approach(s.safety, safetyTarget, 18, dt);

    const capacity =
      105 *
      (0.5 + 0.5 * s.machineHealth / 100) *
      (0.55 + 0.45 * Math.min(1, s.workforceSkill / s.requiredSkill)) *
      (0.7 + 0.3 * s.inventory / 100) *
      (1 + p['factory.overtime'] * 0.0025);
    const planned = 45 + p['factory.productionTarget'] * 0.65;
    const requested = s.demand + Math.min(s.backlog / 12, 20);
    s.throughput = approach(s.throughput, Math.min(capacity, planned, requested), 3.5, dt);
    s.defectRate = approach(
      s.defectRate,
      clamp(8.5 - s.qualityCapability * 0.035 -
        s.workforceSkill * 0.025 - s.machineHealth * 0.018 +
        p['factory.overtime'] * 0.03 +
        Math.max(0, p['factory.productionTarget'] - 75) * 0.018 +
        modifiers.machinePenalty * 0.07, 0.6, 12),
      8,
      dt
    );
    s.goodOutput = s.throughput * (1 - s.defectRate / 100);
    const shipment = Math.min(
      s.goodOutput,
      s.demand + Math.min(s.backlog / 10, 18)
    );
    s.backlog = clamp(s.backlog + (s.demand - shipment) * dt, 0, 520);
    s.fulfillment = approach(
      s.fulfillment,
      100 * clamp(shipment / Math.max(1, s.demand), 0, 1),
      7,
      dt
    );

    const schoolRevenue = 2.78 + s.trust * 0.003;
    const educationInvestment =
      p['school.curriculum'] * 0.006 +
      p['school.teacherTraining'] * 0.005 +
      p['school.labInvestment'] * 0.007 +
      p['bridge.internships'] * 0.002;
    const studentSupportCost = p['school.studentSupport'] * 0.006;
    const schoolCost = 1.35 + educationInvestment + studentSupportCost;
    const rawSchoolCash = s.schoolCash + (schoolRevenue - schoolCost) * dt;
    const schoolLiquiditySupport = Math.max(0, -rawSchoolCash);
    const schoolCeilingSweep = Math.max(0, rawSchoolCash - 2000);
    s.schoolCash = clamp(rawSchoolCash, 0, 2000);
    const factoryRevenue = shipment * 0.046;
    const factoryPolicyInvestment =
      p['factory.maintenance'] * 0.004 +
      p['factory.workforceTraining'] * 0.003;
    const overtimeCost = p['factory.overtime'] * 0.006;
    const factoryCost =
      0.82 + s.throughput * 0.018 + factoryPolicyInvestment + overtimeCost;
    const rawFactoryCash = s.factoryCash + (factoryRevenue - factoryCost) * dt;
    const factoryLiquiditySupport = Math.max(0, -rawFactoryCash);
    const factoryCeilingSweep = Math.max(0, rawFactoryCash - 5000);
    s.factoryCash = clamp(rawFactoryCash, 0, 5000);

    this.day += dt;
    this.updateEvents(dt);
    this.derived = this.computeDerived();
    s.connection = approach(s.connection, this.derived.connection, 12, dt);
    this.derived.connection = s.connection;
    this.updateGuards();
    this.accumulateStats(dt, p, {
      schoolRevenue: schoolRevenue,
      schoolCost: schoolCost,
      educationInvestment: educationInvestment,
      studentSupportCost: studentSupportCost,
      schoolLiquiditySupport: schoolLiquiditySupport,
      schoolCeilingSweep: schoolCeilingSweep,
      factoryRevenue: factoryRevenue,
      factoryCost: factoryCost,
      factoryPolicyInvestment: factoryPolicyInvestment,
      factoryLiquiditySupport: factoryLiquiditySupport,
      factoryCeilingSweep: factoryCeilingSweep,
      shipment: shipment
    });
    this.updateRecoveries(dt);
    if (Math.floor((this.day - dt) / 3) !== Math.floor(this.day / 3)) {
      this.recordHistory();
    }
  }

  accumulateStats(dt, effectivePolicy, flows) {
    const stats = this.stats;
    const state = this.state;
    const derived = this.derived;
    stats.elapsedDays += dt;

    stats.finance.schoolRevenue += flows.schoolRevenue * dt;
    stats.finance.schoolCost += flows.schoolCost * dt;
    stats.finance.educationInvestment += flows.educationInvestment * dt;
    stats.finance.studentSupportCost += flows.studentSupportCost * dt;
    stats.finance.factoryRevenue += flows.factoryRevenue * dt;
    stats.finance.factoryCost += flows.factoryCost * dt;
    stats.finance.factoryPolicyInvestment += flows.factoryPolicyInvestment * dt;
    stats.finance.schoolLiquiditySupport += flows.schoolLiquiditySupport;
    stats.finance.factoryLiquiditySupport += flows.factoryLiquiditySupport;
    stats.finance.schoolCeilingSweep += flows.schoolCeilingSweep;
    stats.finance.factoryCeilingSweep += flows.factoryCeilingSweep;

    stats.operations.producedUnits += state.throughput * dt;
    stats.operations.goodUnits += state.goodOutput * dt;
    stats.operations.defectUnits += Math.max(0, state.throughput - state.goodOutput) * dt;
    stats.operations.shippedUnits += flows.shipment * dt;
    stats.operations.demandUnits += state.demand * dt;
    stats.operations.servedDemandUnits += Math.min(flows.shipment, state.demand) * dt;

    stats.weighted.connection += state.connection * dt;
    stats.weighted.readiness += state.readiness * dt;
    stats.weighted.skillGap += derived.skillGap * dt;
    stats.weighted.wellbeing += state.wellbeing * dt;
    stats.weighted.safety += state.safety * dt;
    stats.weighted.machineHealth += state.machineHealth * dt;
    stats.weighted.backlog += state.backlog * dt;

    stats.extremes.minimumWellbeing =
      Math.min(stats.extremes.minimumWellbeing, state.wellbeing);
    stats.extremes.minimumSafety =
      Math.min(stats.extremes.minimumSafety, state.safety);
    stats.extremes.minimumMachineHealth =
      Math.min(stats.extremes.minimumMachineHealth, state.machineHealth);
    stats.extremes.minimumSchoolCash =
      Math.min(stats.extremes.minimumSchoolCash, state.schoolCash);
    stats.extremes.minimumFactoryCash =
      Math.min(stats.extremes.minimumFactoryCash, state.factoryCash);
    stats.extremes.maximumBacklog =
      Math.max(stats.extremes.maximumBacklog, state.backlog);
    stats.extremes.maximumSkillGap =
      Math.max(stats.extremes.maximumSkillGap, derived.skillGap);

    Object.keys(stats.guardDays).forEach((key) => {
      if (this.guards[key]) {
        stats.guardDays[key] += dt;
        stats.currentGuardEpisodeDays[key] += dt;
        stats.longestGuardEpisodeDays[key] = Math.max(
          stats.longestGuardEpisodeDays[key],
          stats.currentGuardEpisodeDays[key]
        );
      } else {
        stats.currentGuardEpisodeDays[key] = 0;
      }
    });

    const critical = {
      studentWellbeing: state.wellbeing < 65,
      industrialSafety: state.safety < 75,
      schoolCashZero: state.schoolCash <= 1e-9,
      factoryCashZero: state.factoryCash <= 1e-9
    };
    Object.keys(critical).forEach(function (key) {
      if (critical[key]) stats.criticalDays[key] += dt;
    });
    if (Object.values(critical).some(Boolean)) stats.criticalAnyDays += dt;

    const constrained = Object.keys(this.policy).some((key) => {
      return Math.abs(this.policy[key] - effectivePolicy[key]) > 0.05;
    });
    if (constrained) stats.constrainedPolicyDays += dt;
  }

  updateEvents(dt) {
    const active = [];
    this.events.forEach((event) => {
      event.remaining -= dt;
      if (event.remaining > 1e-9) {
        active.push(event);
      } else {
        const recovery = this.recoveries.find(function (item) {
          return item.eventId === event.id;
        });
        if (recovery && recovery.endDay === null) {
          recovery.endDay = this.day;
        }
        this.addLog('사건 종료', event.name + ' 영향이 종료됐습니다.', 'recovery');
      }
    });
    this.events = active;
  }

  recoveryStable(recovery) {
    const state = this.state;
    const baseline = recovery.baseline;
    const skillGap = Math.max(0, state.requiredSkill - state.readiness);
    const fulfillmentTarget = Math.min(90, baseline.fulfillment - 3);

    if (recovery.type === 'demand') {
      return state.fulfillment >= fulfillmentTarget &&
        state.backlog <= Math.max(120, baseline.backlog * 1.1);
    }
    if (recovery.type === 'supply') {
      return state.inventory >= baseline.inventory * 0.9 &&
        state.fulfillment >= fulfillmentTarget;
    }
    if (recovery.type === 'machine') {
      return state.machineHealth >= baseline.machineHealth * 0.95 &&
        state.safety >= 82 &&
        state.fulfillment >= fulfillmentTarget;
    }
    return state.teacherCapacity >= baseline.teacherCapacity * 0.95 &&
      state.wellbeing >= Math.max(72, baseline.wellbeing - 3) &&
      skillGap <= baseline.skillGap + 2;
  }

  updateRecoveries(dt) {
    this.recoveries.forEach((recovery) => {
      if (recovery.endDay === null || recovery.recoveredDay !== null) return;
      if (this.recoveryStable(recovery)) {
        recovery.stableDays += dt;
        if (recovery.stableDays + 1e-9 >= 5) {
          recovery.recoveredDay = this.day;
          this.addLog(
            '회복 확인',
            recovery.name + ' 종료 후 운영 기준을 5일 연속 충족했습니다.',
            'recovery'
          );
        }
      } else {
        recovery.stableDays = 0;
      }
    });
  }

  updateGuards() {
    const s = this.state;
    const p = this.policy;
    const requestedSafety =
      83 + p['factory.maintenance'] * 0.1 +
      p['factory.workforceTraining'] * 0.08 -
      p['factory.overtime'] * 0.23 -
      Math.max(0, p['factory.productionTarget'] - 75) * 0.12;
    const safetyPolicyRisk = requestedSafety < 82;
    const next = {
      student: this.guards.student ? s.wellbeing < 75 : s.wellbeing < 72,
      safety: this.guards.safety
        ? s.safety < 86 || s.machineHealth < 68 || safetyPolicyRisk
        : s.safety < 82 || s.machineHealth < 62 || safetyPolicyRisk,
      schoolLiquidity: this.guards.schoolLiquidity
        ? s.schoolCash < 240
        : s.schoolCash < 180,
      factoryLiquidity: this.guards.factoryLiquidity
        ? s.factoryCash < 330
        : s.factoryCash < 250
    };
    Object.keys(next).forEach((key) => {
      if (next[key] !== this.guards[key]) {
        if (next[key] && this.stats) {
          this.stats.guardEpisodes[key] += 1;
        }
        this.addLog(
          '보호 상태 변경',
          key + ': ' + (next[key] ? '개입' : '해제'),
          next[key] ? 'guard' : 'recovery'
        );
      }
    });
    this.guards = next;
  }

  computeDerived() {
    const s = this.state;
    const skillGap = Math.max(0, s.requiredSkill - s.readiness);
    const skillFulfillment = clamp(s.readiness / Math.max(1, s.requiredSkill) * 100, 0, 100);
    const outputIndex = clamp(s.goodOutput / Math.max(1, s.demand) * 100, 0, 100);
    return {
      skillGap: skillGap,
      skillFulfillment: skillFulfillment,
      outputIndex: outputIndex,
      combinedCash: s.schoolCash + s.factoryCash,
      connection: clamp(
        skillFulfillment * 0.3 + s.trust * 0.2 +
        s.wellbeing * 0.14 + s.safety * 0.14 +
        s.fulfillment * 0.12 + this.policy['bridge.feedback'] * 0.1,
        0,
        100
      )
    };
  }

  recordHistory() {
    this.history.push({
      day: round(this.day, 2),
      connection: round(this.state.connection, 2),
      wellbeing: round(this.state.wellbeing, 2),
      safety: round(this.state.safety, 2),
      goodOutput: round(this.state.goodOutput, 2),
      schoolCash: round(this.state.schoolCash, 2),
      factoryCash: round(this.state.factoryCash, 2)
    });
    if (this.history.length > 61) {
      this.history.shift();
    }
  }

  addLog(title, description, type) {
    this.logs.unshift({
      day: round(this.day, 2),
      type: type,
      title: title,
      description: description
    });
    if (this.logs.length > 30) {
      this.logs.pop();
    }
  }

  date() {
    return new Date(START_DATE.getTime() + this.day * 86400000)
      .toISOString()
      .slice(0, 10);
  }

  advice() {
    const s = this.state;
    const d = this.computeDerived();
    const items = [];
    function add(level, title, reason) {
      if (items.length < 3) {
        items.push({ level: level, title: title, reason: reason });
      }
    }
    if (this.guards.safety) {
      add('critical', '증산보다 정비 여유가 먼저입니다.',
        '안전 ' + round(s.safety, 1) + ', 설비 ' + round(s.machineHealth, 1) +
        '이며 초과근무와 생산 목표가 제한됩니다.');
    }
    if (this.guards.student) {
      add('critical', '학생 지원과 실습 감독을 우선하세요.',
        '웰빙 ' + round(s.wellbeing, 1) + '로 현장실습 유효 강도가 제한됩니다.');
    }
    if (d.skillGap > 12) {
      add('warning', '직무 수요를 교육과정에 더 빨리 반영하세요.',
        '역량 격차 ' + round(d.skillGap, 1) + '%p이며 교육 효과에는 30~80일이 필요합니다.');
    }
    if (s.defectRate > 4.5) {
      add('warning', '초과근무보다 정비와 훈련을 높이세요.',
        '불량률 ' + round(s.defectRate, 1) + '%로 품질과 안전의 동시 개선이 필요합니다.');
    }
    if (this.guards.schoolLiquidity) {
      add('warning', '교육 재량 지출의 시점을 분산하세요.',
        '교육 잔액 ' + round(s.schoolCash, 0) + '백만원이며 학생 지원은 보호됩니다.');
    }
    if (this.guards.factoryLiquidity) {
      add('warning', '현금 범위 안에서 생산과 재고 목표를 낮추세요.',
        '공장 현금 ' + round(s.factoryCash, 0) + '백만원으로 유효 목표가 제한됩니다.');
    }
    if (items.length < 3) {
      add('ok', '보호 기준 안에서 연결 체계가 움직입니다.',
        '연결 ' + round(s.connection, 1) + ', 웰빙 ' + round(s.wellbeing, 1) +
        ', 안전 ' + round(s.safety, 1) + '입니다.');
    }
    if (items.length < 3) {
      add('experiment', '한 번에 하나의 정책만 바꿔 보세요.',
        '기준 상태에서 30일 이상 관찰하면 지연 효과를 구분하기 쉽습니다.');
    }
    return items;
  }

  results() {
    const stats = this.stats;
    const state = this.state;
    const elapsed = stats.elapsedDays;
    const average = function (total, fallback) {
      return elapsed > 0 ? total / elapsed : fallback;
    };
    const ratio = function (numerator, denominator) {
      return denominator > 1e-9 ? numerator / denominator : null;
    };
    const schoolNetOperatingFlow =
      stats.finance.schoolRevenue - stats.finance.schoolCost;
    const factoryNetOperatingFlow =
      stats.finance.factoryRevenue - stats.finance.factoryCost;
    const roundMap = function (source) {
      const result = {};
      Object.keys(source).forEach(function (key) {
        result[key] = round(source[key], 3);
      });
      return result;
    };

    return {
      scenario: this.scenario,
      scenarioName: SCENARIOS[this.scenario],
      elapsedDays: round(elapsed, 2),
      finance: {
        schoolRevenue: round(stats.finance.schoolRevenue, 3),
        schoolCost: round(stats.finance.schoolCost, 3),
        educationInvestment: round(stats.finance.educationInvestment, 3),
        studentSupportCost: round(stats.finance.studentSupportCost, 3),
        schoolNetOperatingFlow: round(schoolNetOperatingFlow, 3),
        factoryRevenue: round(stats.finance.factoryRevenue, 3),
        factoryCost: round(stats.finance.factoryCost, 3),
        factoryPolicyInvestment: round(stats.finance.factoryPolicyInvestment, 3),
        factoryNetOperatingFlow: round(factoryNetOperatingFlow, 3),
        partnershipNetOperatingFlow: round(
          schoolNetOperatingFlow + factoryNetOperatingFlow,
          3
        ),
        cashChange: {
          school: round(state.schoolCash - stats.startCash.school, 3),
          factory: round(state.factoryCash - stats.startCash.factory, 3)
        },
        liquiditySupport: {
          school: round(stats.finance.schoolLiquiditySupport, 3),
          factory: round(stats.finance.factoryLiquiditySupport, 3)
        },
        ceilingSweep: {
          school: round(stats.finance.schoolCeilingSweep, 3),
          factory: round(stats.finance.factoryCeilingSweep, 3)
        }
      },
      operations: {
        producedUnits: round(stats.operations.producedUnits, 2),
        goodUnits: round(stats.operations.goodUnits, 2),
        defectUnits: round(stats.operations.defectUnits, 2),
        shippedUnits: round(stats.operations.shippedUnits, 2),
        demandUnits: round(stats.operations.demandUnits, 2),
        averageGoodOutput: elapsed > 0
          ? round(stats.operations.goodUnits / elapsed, 3)
          : null,
        weightedDefectRate: stats.operations.producedUnits > 1e-9
          ? round(100 * ratio(
            stats.operations.defectUnits,
            stats.operations.producedUnits
          ), 3)
          : null,
        demandServiceLevel: stats.operations.demandUnits > 1e-9
          ? round(100 * ratio(
            stats.operations.servedDemandUnits,
            stats.operations.demandUnits
          ), 3)
          : null
      },
      averages: {
        connection: round(average(stats.weighted.connection, state.connection), 3),
        readiness: round(average(stats.weighted.readiness, state.readiness), 3),
        skillGap: round(average(
          stats.weighted.skillGap,
          Math.max(0, state.requiredSkill - state.readiness)
        ), 3),
        wellbeing: round(average(stats.weighted.wellbeing, state.wellbeing), 3),
        safety: round(average(stats.weighted.safety, state.safety), 3),
        machineHealth: round(
          average(stats.weighted.machineHealth, state.machineHealth),
          3
        ),
        backlog: round(average(stats.weighted.backlog, state.backlog), 3)
      },
      extremes: roundMap(stats.extremes),
      guardDays: roundMap(stats.guardDays),
      guardEpisodes: Object.assign({}, stats.guardEpisodes),
      longestGuardEpisodeDays: roundMap(stats.longestGuardEpisodeDays),
      criticalDays: roundMap(stats.criticalDays),
      criticalAnyDays: round(stats.criticalAnyDays, 3),
      constrainedPolicyDays: round(stats.constrainedPolicyDays, 3),
      recoveries: this.recoveries.map((recovery) => {
        const ended = recovery.endDay !== null;
        const recovered = recovery.recoveredDay !== null;
        return {
          type: recovery.type,
          name: recovery.name,
          startDay: round(recovery.startDay, 2),
          endDay: ended ? round(recovery.endDay, 2) : null,
          recoveredDay: recovered ? round(recovery.recoveredDay, 2) : null,
          recovered: recovered,
          active: !ended,
          eventDurationDays: round(
            (ended ? recovery.endDay : this.day) - recovery.startDay,
            2
          ),
          recoveryDays: recovered
            ? round(recovery.recoveredDay - recovery.startDay, 2)
            : null,
          postEventRecoveryDays: recovered
            ? round(recovery.recoveredDay - recovery.endDay, 2)
            : null
        };
      })
    };
  }

  snapshot() {
    const s = this.state;
    const d = this.computeDerived();
    return {
      scenario: this.scenario,
      scenarioName: SCENARIOS[this.scenario],
      day: round(this.day, 2),
      date: this.date(),
      metrics: {
        connection: round(s.connection, 2),
        readiness: round(s.readiness, 2),
        requiredSkill: round(s.requiredSkill, 2),
        skillFulfillment: round(d.skillFulfillment, 2),
        skillGap: round(d.skillGap, 2),
        wellbeing: round(s.wellbeing, 2),
        schoolCash: round(s.schoolCash, 2),
        labUtilization: round(s.labUtilization, 2),
        goodOutput: round(s.goodOutput, 2),
        defectRate: round(s.defectRate, 2),
        fulfillment: round(s.fulfillment, 2),
        backlog: round(s.backlog, 2),
        machineHealth: round(s.machineHealth, 2),
        safety: round(s.safety, 2),
        inventory: round(s.inventory, 2),
        factoryCash: round(s.factoryCash, 2),
        trust: round(s.trust, 2),
        combinedCash: round(d.combinedCash, 2)
      },
      guards: Object.assign({}, this.guards),
      activeEvents: this.events.map(function (event) {
        return {
          type: event.type,
          name: event.name,
          remainingDays: round(event.remaining, 2)
        };
      }),
      policy: Object.assign({}, this.policy),
      effectivePolicy: this.effectivePolicy(),
      advice: this.advice(),
      recentLogs: this.logs.slice(0, 8)
    };
  }
}

export { Simulation, POLICY_SPECS, EVENT_DEFINITIONS, SCENARIOS, STEP_DAYS };

