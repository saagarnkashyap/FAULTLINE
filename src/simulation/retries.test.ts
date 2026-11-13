import { describe, expect, it } from "vitest";
import { failchainScenario } from "../scenarios/failchain";
import { RECOVERY_EXPERIMENT } from "../scenarios/resurrection";
import { failService, initializeSimulation, repairService, resetSimulation, step, validateScenario } from "./engine";
import type { RetryConfig, RetryPolicy, SimulationScenario, SimulationState } from "./types";

function scenario(policy: RetryPolicy = "controlled", overrides: Partial<RetryConfig> = {}): SimulationScenario {
  return { ...failchainScenario, retry: { ...RECOVERY_EXPERIMENT.retry, policy, ...overrides } };
}

function ledger(state: SimulationState) {
  if (!state.retry) throw new Error("Retry ledger missing");
  return state.retry;
}

function assertAccounting(topology: SimulationScenario, state: SimulationState, previous?: SimulationState) {
  const retry = ledger(state);
  expect(retry.totalUniqueRequests).toBe(retry.totalCompletedRequests + retry.totalAbandonedRequests + retry.pendingRequests);
  expect(retry.pendingRequests).toBe(retry.cohorts.reduce((sum, cohort) => sum + cohort.count, 0));
  expect(retry.pendingRequests).toBeLessThanOrEqual(topology.retry!.maxPendingRequests);
  expect(retry.completedNewRequestsPerTick).toBeLessThanOrEqual(retry.newRequestsPerTick);
  expect(retry.completedRetryRequestsPerTick).toBeLessThanOrEqual(retry.retryAttemptsPerTick);
  expect(state.routingPool!.incomingDemandPerTick).toBe(retry.newRequestsPerTick + retry.retryAttemptsPerTick);
  expect(state.routingPool!.processedRequestsPerTick).toBe(retry.completedNewRequestsPerTick + retry.completedRetryRequestsPerTick);
  if (previous) {
    expect(ledger(previous).pendingRequests + retry.newRequestsPerTick).toBe(
      retry.pendingRequests + retry.completedNewRequestsPerTick + retry.completedRetryRequestsPerTick + retry.abandonedRequestsPerTick,
    );
    expect(retry.totalUniqueRequests).toBe(ledger(previous).totalUniqueRequests + topology.routingPool!.demandPerTick);
  }
  for (const [index, cohort] of retry.cohorts.entries()) {
    expect(cohort.count).toBeGreaterThan(0);
    expect(state.tick - cohort.bornTick).toBeLessThan(topology.retry!.maxAgeTicks);
    if (index) expect(cohort.bornTick).toBeGreaterThan(retry.cohorts[index - 1]!.bornTick);
  }
  for (const id of topology.routingPool!.memberIds) {
    const service = state.services[id]!;
    if (service.status === "offline" || service.status === "recovering") {
      expect(state.routingPool!.members[id]!.processedRequestsPerTick).toBe(0);
    }
  }
  for (const value of Object.values(retry)) {
    if (typeof value === "number") {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  }
}

function replay(topology: SimulationScenario, ticks = 40) {
  let state = initializeSimulation(topology);
  const states = [state];
  for (let tick = 1; tick <= ticks; tick += 1) {
    const previous = state;
    state = step(topology, previous, RECOVERY_EXPERIMENT.schedule.find((item) => item.tick === tick)?.command);
    assertAccounting(topology, state, previous);
    states.push(state);
  }
  return states;
}

describe("bounded retry backlog and unique request accounting", () => {
  it.each(["naive", "controlled"] as const)("conserves unique requests on every tick under %s admission", (policy) => {
    const states = replay(scenario(policy));
    expect(ledger(states[40]!).totalUniqueRequests).toBe(4800);
  });

  it("starts empty, processes new requests normally, and grows backlog during unavailability", () => {
    const states = replay(scenario(), 7);
    expect(ledger(states[0]!).pendingRequests).toBe(0);
    expect(ledger(states[1]!).totalCompletedRequests).toBe(120);
    expect(ledger(states[2]!).pendingRequests).toBe(30);
    expect(ledger(states[3]!).pendingRequests).toBe(60);
    expect(ledger(states[4]!).pendingRequests).toBe(180);
    expect(ledger(states[7]!).pendingRequests).toBe(540);
    expect(ledger(states[7]!).retryAttemptsPerTick).toBe(0);
  });

  it("counts repeated retry attempts without inventing new unique requests or resetting request age", () => {
    const states = replay(scenario("naive"), 4);
    expect(ledger(states[3]!).retryAttemptsPerTick).toBe(30);
    expect(ledger(states[4]!).retryAttemptsPerTick).toBe(60);
    expect(ledger(states[4]!).totalRetryAttempts).toBe(90);
    expect(ledger(states[4]!).totalUniqueRequests).toBe(480);
    expect(ledger(states[4]!).totalCompletedRequests).toBe(300);
    expect(ledger(states[4]!).pendingRequests).toBe(180);
    expect(ledger(states[4]!).cohorts[0]).toEqual({ bornTick: 2, count: 30 });
  });

  it("removes successful retries exactly once and completes the oldest issued cohorts first", () => {
    const states = replay(scenario(), 10);
    expect(ledger(states[9]!).completedRetryRequestsPerTick).toBe(30);
    expect(ledger(states[9]!).cohorts.some(({ bornTick }) => bornTick === 2)).toBe(false);
    expect(ledger(states[10]!).cohorts.some(({ bornTick }) => bornTick === 3)).toBe(false);
    expect(ledger(states[10]!).totalCompletedRequests).toBe(690);
  });

  it("keeps new demand and retry completion classification consistent for odd routing remainders", () => {
    const base = scenario("naive");
    const topology = { ...base, routingPool: { ...base.routingPool!, demandPerTick: 121 } };
    const states = replay(topology, 12);
    expect(ledger(states[9]!).newRequestsPerTick).toBe(121);
    expect(ledger(states[9]!).completedNewRequestsPerTick).toBe(121);
  });

  it("caps the queue, retains older cohorts, and records newest overflow as abandoned", () => {
    const states = replay(scenario("controlled", { maxPendingRequests: 50 }), 4);
    expect(ledger(states[3]!).pendingRequests).toBe(50);
    expect(ledger(states[3]!).abandonedRequestsPerTick).toBe(10);
    expect(ledger(states[4]!).cohorts).toEqual([{ bornTick: 2, count: 30 }, { bornTick: 3, count: 20 }]);
    expect(ledger(states[4]!).totalAbandonedRequests).toBe(130);
  });

  it("abandons expired cohorts before retry release, without renewing their age", () => {
    const topology = scenario("naive", { maxAgeTicks: 2 });
    const states = replay(topology, 5);
    expect(ledger(states[4]!).cohorts.some(({ bornTick }) => bornTick === 2)).toBe(false);
    expect(states[4]!.events).toContainEqual(expect.objectContaining({ type: "retry-requests-abandoned", tick: 4, expired: 30 }));
  });

  it("applies eligibility once to new failures and accounts for ineligible requests", () => {
    const states = replay(scenario("controlled", { eligibilityPercent: 33 }), 3);
    expect(ledger(states[2]!).pendingRequests).toBe(9); // floor(30 * 33%).
    expect(ledger(states[2]!).totalAbandonedRequests).toBe(21);
    expect(ledger(states[3]!).pendingRequests).toBe(18);
  });

  it("supports zero retry eligibility and zero queue space without losing requests", () => {
    for (const overrides of [{ eligibilityPercent: 0 }, { maxPendingRequests: 0 }]) {
      const states = replay(scenario("naive", overrides), 4);
      expect(ledger(states[4]!).pendingRequests).toBe(0);
      expect(ledger(states[4]!).totalRetryAttempts).toBe(0);
      expect(ledger(states[4]!).totalAbandonedRequests).toBe(180);
    }
  });

  it("handles zero new demand and no backlog without issuing any attempts", () => {
    const base = scenario();
    const topology = { ...base, routingPool: { ...base.routingPool!, demandPerTick: 0 } };
    let state = initializeSimulation(topology);
    for (let tick = 1; tick <= 4; tick += 1) {
      const previous = state;
      state = step(topology, previous);
      assertAccounting(topology, state, previous);
    }
    expect(ledger(state).totalUniqueRequests).toBe(0);
    expect(ledger(state).totalRetryAttempts).toBe(0);
    expect(ledger(state).stableRecoveryTick).toBe(3);
  });
});

describe("retry admission and restoration", () => {
  it("releases all eligible pending retries under naive admission when capacity returns", () => {
    const states = replay(scenario("naive"), 9);
    expect(ledger(states[7]!).pendingRequests).toBe(540);
    expect(ledger(states[8]!).retryAttemptsPerTick).toBe(540);
    expect(states[8]!.services["gateway-a"]?.traffic?.incomingDemandPerTick).toBe(660);
    expect(ledger(states[8]!).attemptUtilizationPercent).toBe(733.33);
    expect(states[8]!.events).toContainEqual(expect.objectContaining({ type: "recovery-completed", serviceId: "gateway-a", tick: 8 }));
  });

  it("reserves new-request capacity and then obeys the controlled requests-per-tick budget", () => {
    const states = replay(scenario(), 10);
    expect(ledger(states[8]!).retryAttemptsPerTick).toBe(0); // 90 capacity cannot cover 120 new requests.
    expect(ledger(states[9]!).retryAttemptsPerTick).toBe(30);
    expect(states[9]!.routingPool!.incomingDemandPerTick).toBe(150);
    expect(states[9]!.services["gateway-a"]?.traffic?.utilizationPercent).toBe(83.33);
    const biggerBudget = replay(scenario("controlled", { retryBudgetPerTick: 100 }), 9);
    expect(ledger(biggerBudget[9]!).retryAttemptsPerTick).toBe(60); // Spare capacity, not the 100 budget, is limiting.
  });

  it("issues no retries when no capacity is available, even under naive admission", () => {
    const topology = scenario("naive");
    let state = failService(topology, initializeSimulation(topology), "gateway-a");
    state = failService(topology, state, "gateway-b");
    expect(ledger(state).pendingRequests).toBe(150);
    expect(ledger(state).retryAttemptsPerTick).toBe(0);
    expect(state.routingPool!.processedRequestsPerTick).toBe(0);
    assertAccounting(topology, state);
  });

  it("lets naive retry pressure produce secondary failures while controlled admission avoids them", () => {
    const naive = replay(scenario("naive"), 11);
    const controlled = replay(scenario(), 11);
    expect(naive[10]!.services["gateway-a"]?.local).toEqual({ kind: "failed", cause: { type: "overload", tick: 10 } });
    expect(naive[11]!.services["gateway-b"]?.local).toEqual({ kind: "failed", cause: { type: "overload", tick: 11 } });
    expect(naive[11]!.events.filter((event) => event.type === "overload-failed" && event.afterRepair)).toHaveLength(2);
    expect(controlled[11]!.services["gateway-a"]?.status).toBe("healthy");
    expect(controlled[11]!.services["gateway-b"]?.status).toBe("healthy");
    expect(controlled[11]!.events.filter((event) => event.type === "overload-failed" && event.afterRepair)).toHaveLength(0);
  });

  it("confirms stable recovery only on the third qualifying tick and does not repeat the event", () => {
    const states = replay(scenario(), 31);
    expect(ledger(states[26]!).pendingRequests).toBe(30);
    expect(ledger(states[27]!).pendingRequests).toBe(0);
    expect(ledger(states[28]!).stableRecoveryTick).toBeNull();
    expect(ledger(states[29]!).stableRecoveryTick).toBe(29);
    expect(ledger(states[31]!).stableRecoveryTick).toBe(29);
    expect(states[31]!.events.filter(({ type }) => type === "stable-recovery-achieved")).toHaveLength(1);
    const interrupted = failService(scenario(), states[31]!, "gateway-a");
    expect(ledger(interrupted).stableRecoveryTick).toBeNull();
  });

  it("does not claim stable recovery while a locally failed backend remains, even with no backlog", () => {
    const base = scenario();
    const topology = { ...base, routingPool: { ...base.routingPool!, demandPerTick: 60 } };
    let state = failService(topology, initializeSimulation(topology), "gateway-a");
    for (let i = 0; i < 5; i += 1) state = step(topology, state);
    expect(state.services.gateway?.status).toBe("healthy");
    expect(ledger(state).pendingRequests).toBe(0);
    expect(ledger(state).stableRecoveryTick).toBeNull();
    state = repairService(topology, state, "gateway-a");
    for (let i = 0; i < 4; i += 1) state = step(topology, state);
    expect(ledger(state).stableRecoveryTick).toBe(11);
  });
});

describe("optional retry compatibility, validation, and immutability", () => {
  it("leaves the Phase 2B run retry-free and unchanged when retries are disabled", () => {
    const initial = initializeSimulation(failchainScenario);
    const failed = failService(failchainScenario, initial, "gateway-a");
    expect(initial.retry).toBeUndefined();
    expect(failed.retry).toBeUndefined();
    expect(failed.routingPool!.members["gateway-b"]!.assignedRequestsPerTick).toBe(120);
    expect(failed.events.some(({ type }) => type.startsWith("retry"))).toBe(false);
  });

  it("resets the entire retry ledger and preserves the configured policy", () => {
    const topology = scenario("naive");
    const states = replay(topology, 10);
    const reset = resetSimulation(topology);
    expect(reset).toEqual(initializeSimulation(topology));
    expect(reset.retry!.repairedMemberIds).toEqual([]);
    expect(topology.retry!.policy).toBe("naive");
    expect(states[10]!.retry!.totalRetryAttempts).toBeGreaterThan(0);
  });

  it("rejects invalid queue, age, eligibility, budget, and unsafe cumulative totals", () => {
    for (const overrides of [{ maxPendingRequests: -1 }, { maxAgeTicks: 0 }, { eligibilityPercent: 101 },
      { eligibilityPercent: 1.5 }, { retryBudgetPerTick: NaN }, { retryBudgetPerTick: -1 },
      { maxPendingRequests: Number.MAX_SAFE_INTEGER }]) {
      expect(() => validateScenario(scenario("controlled", overrides))).toThrow(/Retry/);
    }
    expect(() => validateScenario({ ...scenario(), routingPool: undefined })).toThrow(/routing pool/);
  });

  it("does not mutate frozen scenarios, queue cohorts, snapshots, or commands", () => {
    function freezeDeep<T>(value: T): T {
      if (value !== null && typeof value === "object") { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
      return value;
    }
    const topology = freezeDeep(structuredClone(scenario("naive")));
    const before = structuredClone(topology);
    let state = freezeDeep(initializeSimulation(topology));
    for (let tick = 1; tick <= 12; tick += 1) {
      const previous = state;
      const snapshot = structuredClone(state);
      const command = RECOVERY_EXPERIMENT.schedule.find((item) => item.tick === tick)?.command;
      state = freezeDeep(step(topology, state, command));
      expect(previous).toEqual(snapshot);
    }
    expect(topology).toEqual(before);
  });
});
