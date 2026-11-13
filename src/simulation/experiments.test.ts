import { describe, expect, it } from "vitest";
import { createAppState, reduceAppState } from "../appState";
import { failchainScenario } from "../scenarios/failchain";
import { RECOVERY_EXPERIMENT } from "../scenarios/resurrection";
import { compareRecoveryStrategies, runRecoveryExperiment } from "./experiments";

describe("fair, isolated recovery comparison", () => {
  it("computes the expected contrasting outcomes from the same demand, commands, and retry configuration", () => {
    const result = compareRecoveryStrategies(RECOVERY_EXPERIMENT);
    expect(result.naive.initialState).toEqual(result.controlled.initialState);
    expect(result.naive.initialState).not.toBe(result.controlled.initialState);
    const commands = (run: typeof result.naive) => run.finalState.events.filter(({ type }) => type === "command-applied");
    expect(commands(result.naive)).toEqual(commands(result.controlled));
    expect(commands(result.naive).map(({ tick }) => tick)).toEqual([2, 6, 7]);
    expect(result.naive.metrics).toEqual({
      totalUniqueRequests: 4800, completedUniqueRequests: 660, retryAttempts: 2250,
      abandonedRequests: 1740, pendingRequests: 2400, peakGatewayUtilizationPercent: 733.33,
      overloadFailures: 3, secondaryFailures: 2, unavailableTicks: 34, stableRecoveryTick: null,
    });
    expect(result.controlled.metrics).toEqual({
      totalUniqueRequests: 4800, completedUniqueRequests: 4800, retryAttempts: 570,
      abandonedRequests: 0, pendingRequests: 0, peakGatewayUtilizationPercent: 133.33,
      overloadFailures: 1, secondaryFailures: 0, unavailableTicks: 4, stableRecoveryTick: 29,
    });
    for (const run of [result.naive, result.controlled]) {
      expect(run.metrics.totalUniqueRequests).toBe(run.metrics.completedUniqueRequests + run.metrics.abandonedRequests + run.metrics.pendingRequests);
      expect(run.finalState.events.filter(({ type }) => type === "recovery-completed").map(({ tick }) => tick)).toEqual([8, 9]);
    }
  });

  it("replays exactly and does not alter an active manual simulation", () => {
    const manual = reduceAppState(failchainScenario, createAppState(failchainScenario), { type: "fail" });
    const copy = structuredClone(manual);
    const first = compareRecoveryStrategies(RECOVERY_EXPERIMENT);
    expect(compareRecoveryStrategies(RECOVERY_EXPERIMENT)).toEqual(first);
    expect(manual).toEqual(copy);
    expect(failchainScenario.retry).toBeUndefined();
  });

  it("gives identical outcomes to both policies when no requests are eligible for retry", () => {
    const noRetries = { ...RECOVERY_EXPERIMENT, retry: { ...RECOVERY_EXPERIMENT.retry, eligibilityPercent: 0 } };
    const result = compareRecoveryStrategies(noRetries);
    expect(result.naive.metrics).toEqual(result.controlled.metrics);
    expect(result.naive.metrics.retryAttempts).toBe(0);
    expect(result.naive.metrics.secondaryFailures).toBe(0);
    expect(result.naive.metrics.pendingRequests).toBe(0);
    expect(result.naive.metrics.stableRecoveryTick).toBe(11);
  });

  it("does not claim recovery while a zero retry budget leaves pending requests at the horizon", () => {
    const noBudget = { ...RECOVERY_EXPERIMENT, retry: { ...RECOVERY_EXPERIMENT.retry, retryBudgetPerTick: 0 } };
    const run = runRecoveryExperiment(noBudget, "controlled");
    expect(run.finalState.routingPool!.status).toBe("healthy");
    expect(run.metrics.pendingRequests).toBeGreaterThan(0);
    expect(run.metrics.stableRecoveryTick).toBeNull();
  });

  it("accepts a deeply frozen experiment without mutating its shared inputs or scheduled commands", () => {
    function freezeDeep<T>(value: T): T {
      if (value !== null && typeof value === "object") { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
      return value;
    }
    const experiment = freezeDeep(structuredClone(RECOVERY_EXPERIMENT));
    const snapshot = structuredClone(experiment);
    compareRecoveryStrategies(experiment);
    expect(experiment).toEqual(snapshot);
  });

  it("reports no stable recovery when the horizon ends before restoration", () => {
    const short = { ...RECOVERY_EXPERIMENT, durationTicks: 6,
      schedule: RECOVERY_EXPERIMENT.schedule.filter(({ tick }) => tick <= 6) };
    expect(compareRecoveryStrategies(short).controlled.metrics.stableRecoveryTick).toBeNull();
  });

  it("changes the computed drain time when the controlled budget changes", () => {
    const faster = { ...RECOVERY_EXPERIMENT, retry: { ...RECOVERY_EXPERIMENT.retry, retryBudgetPerTick: 60 } };
    const run = runRecoveryExperiment(faster, "controlled");
    expect(run.metrics.secondaryFailures).toBe(0);
    expect(run.metrics.stableRecoveryTick).toBeLessThan(29);
  });

  it("has a fair fixture where only naive release causes any renewed overload after restoration", () => {
    const base = RECOVERY_EXPERIMENT.scenario;
    // Same capacities and demand in both runs. The 40-capacity B initially trips
    // at demand 60 after A fails; restored A can cover new demand without retries.
    const fixture = { ...RECOVERY_EXPERIMENT,
      scenario: { ...base, routingPool: { ...base.routingPool!, demandPerTick: 60 },
        nodes: base.nodes.map((node) => node.id === "gateway-b" ? { ...node, capacityPerTick: 40 }
          : node.id === "gateway" ? { ...node, capacityPerTick: 130 } : node) },
      retry: { ...RECOVERY_EXPERIMENT.retry, retryBudgetPerTick: 20 },
    };
    const result = compareRecoveryStrategies(fixture);
    expect(result.naive.initialState).toEqual(result.controlled.initialState);
    expect(result.naive.finalState.events.some((event) => event.type === "overload-started" && event.afterRepair)).toBe(true);
    expect(result.naive.metrics.secondaryFailures).toBeGreaterThan(0);
    expect(result.controlled.finalState.events.some((event) => event.type === "overload-started" && event.afterRepair)).toBe(false);
    expect(result.controlled.metrics.secondaryFailures).toBe(0);
    expect(result.controlled.metrics.stableRecoveryTick).not.toBeNull();
  });

  it("rejects duplicate, out-of-range, and invalid scheduled commands instead of silently skipping them", () => {
    expect(() => compareRecoveryStrategies({ ...RECOVERY_EXPERIMENT, schedule: [...RECOVERY_EXPERIMENT.schedule, RECOVERY_EXPERIMENT.schedule[0]!] })).toThrow(/one command/);
    expect(() => compareRecoveryStrategies({ ...RECOVERY_EXPERIMENT, durationTicks: 0 })).toThrow(/duration/);
    expect(() => compareRecoveryStrategies({ ...RECOVERY_EXPERIMENT, durationTicks: 2 })).toThrow(/horizon/);
    expect(() => compareRecoveryStrategies({ ...RECOVERY_EXPERIMENT, schedule: [{ tick: 1, command: { type: "repair", serviceId: "gateway-a" } }] })).toThrow(/locally failed/);
  });
});
