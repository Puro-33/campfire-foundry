import { EVENT_DEFINITIONS, POLICY_SPECS, SCENARIOS, Simulation } from "./school-factory-core.js";

export const SIMULATION_MODEL_VERSION = "school-factory-core/1.0";

export const exposedPolicies = [
  "school.curriculum",
  "school.labInvestment",
  "bridge.feedback",
  "factory.productionTarget",
  "factory.maintenance",
  "factory.overtime",
] as const;

export type Scenario = "balanced" | "demand" | "skills";
export type EventType = "demand" | "supply" | "machine" | "instructor";

type SimulationInput = {
  scenario: Scenario;
  days: number;
  policies: Record<string, number>;
  eventType?: EventType | null;
};

export function policyCatalog() {
  return exposedPolicies.map((key) => ({ key, ...POLICY_SPECS[key] }));
}

export function runServerSimulation(input: SimulationInput) {
  if (!SCENARIOS[input.scenario]) throw new Error("지원하지 않는 시나리오입니다.");
  if (!Number.isInteger(input.days) || input.days < 30 || input.days > 365) {
    throw new Error("기간은 30일에서 365일 사이여야 합니다.");
  }

  const simulation = new Simulation(input.scenario);
  for (const key of exposedPolicies) {
    const spec = POLICY_SPECS[key];
    const value = Number(input.policies[key] ?? spec.initial);
    if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
      throw new Error(`${spec.label} 값이 허용 범위를 벗어났습니다.`);
    }
    simulation.setPolicy(key, value);
  }

  if (input.eventType) {
    if (!EVENT_DEFINITIONS[input.eventType]) throw new Error("지원하지 않는 사건입니다.");
    if (!(input.scenario === "demand" && input.eventType === "demand")) {
      simulation.inject(input.eventType);
    }
  }

  simulation.advance(input.days);
  return {
    modelVersion: SIMULATION_MODEL_VERSION,
    input,
    finalSnapshot: simulation.snapshot(),
    summary: simulation.results(),
  };
}
