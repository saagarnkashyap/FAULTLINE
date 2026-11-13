import { describe, expect, it } from "vitest";
import { createAppState, reduceAppState } from "../appState";
import { AUTOPILOT_EXPERIMENT } from "../scenarios/autopilot";
import { failchainScenario } from "../scenarios/failchain";
import { createAutopilotState, decideAutopilot, DEFAULT_AUTOPILOT_CONFIG, observeAutopilot, stepWithAutopilot, validateAutopilotConfig } from "./autopilot";
import { compareAutopilot, runAutopilotExperiment } from "./autopilotExperiments";
import { initializeSimulation, step } from "./engine";
import type { SimulationScenario } from "./types";

function scenario(demand = 120): SimulationScenario {
  return {
    id: "autopilot-test", nodes: [
      { id: "identity", name: "Identity", description: "Provider", capacityPerTick: 200 },
      { id: "gateway", name: "Gateway", description: "Pool", capacityPerTick: 180 },
      { id: "a", name: "A", description: "Instance", capacityPerTick: 90 },
      { id: "b", name: "B", description: "Instance", capacityPerTick: 90 },
    ],
    dependencies: ["gateway", "a", "b"].map((consumerId) => ({ consumerId, providerId: "identity", kind: "required" })),
    config: { recoveryTicks: 2, maxTicks: 40, tickDurationMs: 1000 },
    workload: { id: "normal", name: "Normal", description: "Test", demandPerTick: { identity: 0, gateway: 0, a: 0, b: 0 } },
    routingPool: { id: "pool", serviceId: "gateway", memberIds: ["a", "b"], demandPerTick: demand },
    retry: { policy: "controlled", maxPendingRequests: 2400, maxAgeTicks: 40, eligibilityPercent: 100, retryBudgetPerTick: 30, maxRetryAttempts: 6 },
  };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
}

describe("AUTOPILOT controller", () => {
  it("detects manual and overload local failures from factual engine events", () => {
    const topology = scenario();
    let simulation = step(topology, initializeSimulation(topology), { type: "fail", serviceId: "a" });
    simulation = step(topology, step(topology, simulation));
    const controller = createAutopilotState(topology, simulation);
    expect(controller.instances.a).toMatchObject({ failedAtTick: 1, cause: "manual", failures: 1 });
    expect(controller.instances.b).toMatchObject({ failedAtTick: 3, cause: "overload", failures: 1 });
    expect(observeAutopilot(topology, simulation, controller)).toBe(controller);
  });

  it("ignores dependency-only outages and non-member local failures", () => {
    const topology = scenario();
    let simulation = step(topology, initializeSimulation(topology), { type: "fail", serviceId: "identity" });
    simulation = step(topology, simulation);
    expect(simulation.services.a).toMatchObject({ status: "offline", local: { kind: "ready" } });
    const controller = createAutopilotState(topology, simulation);
    expect(decideAutopilot(topology, simulation, controller)).toMatchObject({ action: "wait", rule: "no-local-failure" });
    expect(Object.values(controller.instances).every((instance) => instance.failures === 0)).toBe(true);
  });

  it("waits for two complete cooldown ticks before repairing through an ordinary command", () => {
    const topology = scenario(80);
    const failed = step(topology, initializeSimulation(topology), { type: "fail", serviceId: "a" });
    let result = { simulation: failed, controller: createAutopilotState(topology, failed) };
    for (const tick of [2, 3]) {
      result = stepWithAutopilot(topology, result.simulation, result.controller);
      expect(result.simulation.tick).toBe(tick);
      expect(result.controller.decisions.at(-1)).toMatchObject({ action: "wait", rule: "cooldown" });
      expect(result.simulation.services.a!.local.kind).toBe("failed");
    }
    const before = result.simulation;
    result = stepWithAutopilot(topology, before, result.controller);
    expect(result.simulation).toEqual(step(topology, before, { type: "repair", serviceId: "a" }));
    expect(result.simulation.services.a!.local).toEqual({ kind: "recovering", readyAtTick: 6 });
    expect(result.controller.instances.a!.repairActions).toBe(1);
    result = stepWithAutopilot(topology, result.simulation, result.controller);
    expect(result.controller.decisions.at(-1)!.rule).toBe("restart-in-progress");
    expect(result.controller.instances.a!.repairActions).toBe(1);
  });

  it("uses stable IDs for ties, picks one command, and labels pool priority", () => {
    const topology = scenario(0);
    let simulation = step(topology, initializeSimulation(topology), { type: "fail", serviceId: "b" });
    simulation = step(topology, simulation, { type: "fail", serviceId: "a" });
    const controller = createAutopilotState(topology, simulation);
    const config = { ...DEFAULT_AUTOPILOT_CONFIG, cooldownTicks: 0 };
    expect(decideAutopilot(topology, simulation, controller, config)).toMatchObject({ action: "repair", serviceId: "a", rule: "pool-unavailable" });
    const result = stepWithAutopilot(topology, simulation, controller, config);
    expect(result.simulation.events.slice(simulation.events.length).filter((event) => event.type === "command-applied")).toEqual([
      { tick: 3, type: "command-applied", command: "repair", serviceId: "a" },
    ]);
    expect(result.simulation.services.b!.local.kind).toBe("failed");
    const loaded = scenario();
    const degraded = step(loaded, initializeSimulation(loaded), { type: "fail", serviceId: "a" });
    expect(decideAutopilot(loaded, degraded, createAutopilotState(loaded, degraded), config).rule).toBe("pool-degraded");
    const lightlyLoaded = step(topology, initializeSimulation(topology), { type: "fail", serviceId: "a" });
    expect(decideAutopilot(topology, lightlyLoaded, createAutopilotState(topology, lightlyLoaded), config).rule).toBe("local-failure");
  });

  it("does not let a cooling first ID starve another eligible member", () => {
    const topology = scenario(0);
    let simulation = step(topology, initializeSimulation(topology), { type: "fail", serviceId: "b" });
    simulation = step(topology, step(topology, simulation), { type: "fail", serviceId: "a" });
    expect(decideAutopilot(topology, simulation, createAutopilotState(topology, simulation))).toMatchObject({ action: "repair", serviceId: "b" });
  });

  it("waits when healthy and produces identical decisions from frozen inputs", () => {
    const topology = freezeDeep(scenario());
    const simulation = freezeDeep(initializeSimulation(topology));
    const controller = freezeDeep(createAutopilotState(topology, simulation));
    const copy = structuredClone(controller);
    const decision = decideAutopilot(topology, simulation, controller);
    expect(decision).toMatchObject({ action: "wait", rule: "no-local-failure" });
    expect(decideAutopilot(topology, simulation, controller)).toEqual(decision);
    stepWithAutopilot(topology, simulation, controller);
    expect(controller).toEqual(copy);
    expect(simulation.tick).toBe(0);
  });

  it("repair does not guarantee availability when the required provider stays offline", () => {
    const topology = scenario(0);
    let simulation = step(topology, initializeSimulation(topology), { type: "fail", serviceId: "a" });
    simulation = step(topology, simulation, { type: "fail", serviceId: "identity" });
    let result = { simulation, controller: createAutopilotState(topology, simulation) };
    for (let tick = 3; tick <= 6; tick++) result = stepWithAutopilot(topology, result.simulation, result.controller);
    expect(result.simulation.services.a).toMatchObject({ local: { kind: "ready" }, status: "offline" });
    expect(result.controller.instances.a!.repairActions).toBe(1);
    expect(result.simulation.retry!.stableRecoveryTick).toBeNull();
    expect(decideAutopilot(topology, result.simulation, result.controller).action).toBe("wait");
  });

  it("survives repeated overload, postpones restarts, and stops at finite budgets without preventing collapse", () => {
    const topology = scenario(400);
    let result = { simulation: initializeSimulation(topology), controller: createAutopilotState(topology, initializeSimulation(topology)) };
    for (let tick = 1; tick <= 40; tick++) result = stepWithAutopilot(topology, result.simulation, result.controller);
    const histories = Object.values(result.controller.instances);
    expect(histories.map((history) => history.repairActions)).toEqual([2, 2]);
    expect(histories.every((history) => history.failures === 3 && history.failedRecoveryAttempts === 2)).toBe(true);
    expect(result.controller.decisions.some((decision) => decision.rule === "cooldown" && decision.reason.includes("again after repair"))).toBe(true);
    expect(result.controller.decisions.at(-1)!.rule).toBe("budget-exhausted");
    expect(result.simulation.routingPool!.status).toBe("offline");
    expect(result.simulation.retry!.stableRecoveryTick).toBeNull();
    expect(result.simulation.events.some((event) => event.type === "overload-failed" && event.afterRepair)).toBe(true);
    const totalBudget = { ...DEFAULT_AUTOPILOT_CONFIG, maxInterventions: 1 };
    const failed = step(topology, step(topology, step(topology, initializeSimulation(topology))));
    let bounded = { simulation: failed, controller: createAutopilotState(topology, failed) };
    for (let tick = 4; tick <= 20; tick++) bounded = stepWithAutopilot(topology, bounded.simulation, bounded.controller, totalBudget);
    expect(Object.values(bounded.controller.instances).reduce((sum, history) => sum + history.repairActions, 0)).toBe(1);
  });

  it("does nothing at the tick horizon and rejects invalid cooldown/budget configuration", () => {
    const topology = { ...scenario(), config: { ...scenario().config, maxTicks: 1 } };
    const simulation = step(topology, initializeSimulation(topology), { type: "fail", serviceId: "a" });
    const controller = createAutopilotState(topology, simulation);
    expect(decideAutopilot(topology, simulation, controller).rule).toBe("tick-limit");
    const result = stepWithAutopilot(topology, simulation, controller);
    expect(result.simulation).toBe(simulation);
    expect(result.controller).toBe(controller);
    for (const key of ["cooldownTicks", "maxInterventions", "maxRepairsPerInstance"] as const) {
      for (const value of [-1, 1.5, NaN]) expect(() => validateAutopilotConfig({ ...DEFAULT_AUTOPILOT_CONFIG, [key]: value })).toThrow(/AUTOPILOT/);
    }
    expect(() => decideAutopilot(topology, simulation, controller, { ...DEFAULT_AUTOPILOT_CONFIG, cooldownTicks: Number.MAX_SAFE_INTEGER })).toThrow(/safe tick/);
  });
});

describe("AUTOPILOT application integration", () => {
  it("lets Step select a repair without changing selection or mutating previous app state", () => {
    let app = createAppState(failchainScenario);
    app = reduceAppState(failchainScenario, app, { type: "select", serviceId: "gateway-a" });
    app = reduceAppState(failchainScenario, app, { type: "fail" });
    app = reduceAppState(failchainScenario, app, { type: "autopilot", enabled: true });
    app = reduceAppState(failchainScenario, app, { type: "select", serviceId: "calendar" });
    for (let tick = 2; tick <= 3; tick++) app = reduceAppState(failchainScenario, app, { type: "step" });
    const before = freezeDeep(app);
    const expected = step(failchainScenario, before.simulation, { type: "repair", serviceId: "gateway-a" });
    app = reduceAppState(failchainScenario, before, { type: "step" });
    expect(app.simulation).toEqual(expected);
    expect(app.selectedId).toBe("calendar");
    expect(app.controller.decisions.at(-1)).toMatchObject({ action: "repair", serviceId: "gateway-a", tick: 4 });
    expect(before.simulation.tick).toBe(3);
    expect(before.controller.instances["gateway-a"]!.repairActions).toBe(0);
  });

  it("keeps disabled manual stepping identical to the existing engine", () => {
    const topology = failchainScenario;
    let app = createAppState(topology);
    app = reduceAppState(topology, app, { type: "select", serviceId: "gateway-a" });
    let simulation = step(topology, app.simulation, { type: "fail", serviceId: "gateway-a" });
    app = reduceAppState(topology, app, { type: "fail" });
    for (let tick = 2; tick <= 10; tick++) {
      simulation = step(topology, simulation);
      app = reduceAppState(topology, app, { type: "step" });
      expect(app.simulation).toEqual(simulation);
    }
    expect(app.controller.decisions).toEqual([]);
  });

  it("enables on explicit Step, gives manual commands priority, and retains history on toggle", () => {
    const topology = failchainScenario;
    let app = createAppState(topology);
    const simulation = app.simulation;
    app = reduceAppState(topology, app, { type: "autopilot", enabled: true });
    expect(app.simulation).toBe(simulation);
    app = reduceAppState(topology, app, { type: "select", serviceId: "gateway-a" });
    app = reduceAppState(topology, app, { type: "fail" });
    expect(app.controller.decisions.at(-1)!.rule).toBe("manual-priority");
    app = reduceAppState(topology, app, { type: "repair" });
    expect(app.controller.instances["gateway-a"]!.repairActions).toBe(1);
    const controller = app.controller;
    app = reduceAppState(topology, app, { type: "autopilot", enabled: false });
    expect(app.controller).toBe(controller);
    const manualNext = step(topology, app.simulation);
    app = reduceAppState(topology, app, { type: "step" });
    expect(app.simulation).toEqual(manualNext);
    expect(app.controller.decisions).toBe(controller.decisions);
    app = reduceAppState(topology, app, { type: "autopilot", enabled: true });
    expect(app.controller.instances["gateway-a"]!.repairActions).toBe(1);
    const beforeInvalid = app;
    app = reduceAppState(topology, app, { type: "repair" });
    expect(app.error).toMatch(/locally failed/);
    expect(app.simulation).toBe(beforeInvalid.simulation);
    expect(app.controller).toBe(beforeInvalid.controller);
  });

  it("clears controller history and disables on reset/workload changes, preserving selected service", () => {
    let app = createAppState(failchainScenario);
    app = reduceAppState(failchainScenario, app, { type: "autopilot", enabled: true });
    app = reduceAppState(failchainScenario, app, { type: "step" });
    for (const action of [{ type: "reset" } as const, { type: "workload", workloadId: "high" } as const]) {
      const reset = reduceAppState(failchainScenario, app, action);
      expect(reset.simulation.tick).toBe(0);
      expect(reset.autopilotEnabled).toBe(false);
      expect(reset.controller.decisions).toEqual([]);
      expect(reset.controller.instances["gateway-a"]!.repairActions).toBe(0);
      expect(reset.selectedId).toBe(app.selectedId);
    }
  });

  it("validates configurable cooldown, preserves inputs, and refuses actions beyond max ticks", () => {
    const topology = { ...failchainScenario, config: { ...failchainScenario.config, maxTicks: 1 } };
    let app = freezeDeep(createAppState(topology));
    expect(reduceAppState(topology, app, { type: "autopilot-cooldown", cooldownTicks: -1 }).error).toMatch(/AUTOPILOT/);
    app = reduceAppState(topology, app, { type: "autopilot-cooldown", cooldownTicks: 4 });
    expect(app.autopilotConfig.cooldownTicks).toBe(4);
    app = reduceAppState(topology, app, { type: "autopilot", enabled: true });
    app = reduceAppState(topology, app, { type: "step" });
    const previous = app;
    app = reduceAppState(topology, app, { type: "step" });
    expect(app.error).toMatch(/tick limit/);
    expect(app.simulation).toBe(previous.simulation);
    expect(app.controller).toBe(previous.controller);
  });
});

describe("fair repair policy comparison", () => {
  it("reproduces calculated default metrics with identical initial inputs", () => {
    const experiment = freezeDeep(structuredClone(AUTOPILOT_EXPERIMENT));
    const result = compareAutopilot(experiment);
    expect(compareAutopilot(experiment)).toEqual(result);
    expect(result.fixed.initialState).toEqual(result.autopilot.initialState);
    expect(result.fixed.initialState).not.toBe(result.autopilot.initialState);
    expect(result.fixed.metrics).toEqual({ recoveryActions: 2, failedRecoveryAttempts: 0, repeatedInstanceFailures: 0,
      offlineServiceTicks: 27, completedUniqueRequests: 4800, abandonedRequests: 0, pendingRequests: 0, stableRecoveryTick: 32, stableRecoveryAchieved: true });
    expect(result.autopilot.metrics).toEqual({ ...result.fixed.metrics, offlineServiceTicks: 21 });
    for (const run of [result.fixed, result.autopilot]) {
      const commands = run.finalState.events.filter((event) => event.type === "command-applied");
      expect(commands.filter((event) => event.command === "fail")).toEqual([{ tick: 2, type: "command-applied", command: "fail", serviceId: "gateway-a" }]);
      const retry = run.finalState.retry!;
      expect(retry.totalUniqueRequests).toBe(retry.totalCompletedRequests + retry.totalAbandonedRequests + retry.pendingRequests);
      expect(run.controller.decisions).toHaveLength(40);
      expect(new Set(commands.map((event) => event.tick)).size).toBe(commands.length);
    }
    expect(result.fixed.controller.decisions.filter(({ action }) => action === "repair").map(({ tick }) => tick)).toEqual([6, 7]);
    expect(result.autopilot.controller.decisions.filter(({ action }) => action === "repair").map(({ tick }) => tick)).toEqual([5, 7]);
  });

  it("enforces the same cooldown and finite budgets for runbook and controller", () => {
    const base = AUTOPILOT_EXPERIMENT;
    const cooling = compareAutopilot({ ...base, controller: { ...base.controller, cooldownTicks: 6 } });
    expect(cooling.fixed.metrics.recoveryActions).toBe(0);
    expect(cooling.fixed.controller.decisions[5]!.rule).toBe("cooldown");
    for (const run of Object.values(compareAutopilot({ ...base, controller: { ...base.controller, maxInterventions: 1 } }))) {
      expect(run.metrics.recoveryActions).toBe(1);
    }
    const forbidden = compareAutopilot({ ...base, controller: { ...base.controller, maxRepairsPerInstance: 0 } });
    expect(forbidden.fixed.metrics.recoveryActions).toBe(0);
    expect(forbidden.autopilot.metrics.recoveryActions).toBe(0);
    expect(forbidden.fixed.finalState).toEqual(forbidden.autopilot.finalState);
  });

  it("counts renewed local failures and failed repair cycles from engine outcomes", () => {
    const experiment = { ...AUTOPILOT_EXPERIMENT, scenario: scenario(400), failures: [], runbook: [{ tick: 6, serviceId: "a" }, { tick: 7, serviceId: "b" }] };
    const result = compareAutopilot(experiment);
    expect(result.autopilot.metrics).toMatchObject({ recoveryActions: 4, failedRecoveryAttempts: 4, repeatedInstanceFailures: 4, stableRecoveryAchieved: false, stableRecoveryTick: null });
    expect(result.fixed.metrics).toMatchObject({ recoveryActions: 2, failedRecoveryAttempts: 2, repeatedInstanceFailures: 2, stableRecoveryAchieved: false });
  });

  it("lets a fixed runbook outperform ID priority when a larger backend should restart first", () => {
    const topology = scenario(180);
    const experiment = { ...AUTOPILOT_EXPERIMENT, scenario: { ...topology,
      nodes: topology.nodes.map((node) => node.id === "b" ? { ...node, capacityPerTick: 180 } : node),
      retry: { ...topology.retry!, eligibilityPercent: 0 },
      config: { ...topology.config, overloadFailureTicks: 1 } },
      failures: [{ tick: 2, serviceId: "b" }],
      runbook: [{ tick: 5, serviceId: "b" }, { tick: 6, serviceId: "a" }] };
    const result = compareAutopilot(experiment);
    expect(result.fixed.metrics.failedRecoveryAttempts).toBe(0);
    expect(result.autopilot.metrics.failedRecoveryAttempts).toBe(1);
    expect(result.fixed.metrics.stableRecoveryTick).not.toBeNull();
    expect(result.autopilot.metrics.stableRecoveryTick).not.toBeNull();
    expect(result.fixed.metrics.stableRecoveryTick!).toBeLessThan(result.autopilot.metrics.stableRecoveryTick!);
  });

  it("skips invalid runbook slots, prioritizes shared injections, and validates schedules/horizons", () => {
    const base = AUTOPILOT_EXPERIMENT;
    const result = compareAutopilot({ ...base, runbook: [{ tick: 1, serviceId: "gateway-a" }, { tick: 2, serviceId: "gateway-b" }] });
    expect(result.fixed.controller.decisions[0]!.rule).toBe("no-local-failure");
    expect(result.fixed.controller.decisions[1]!.rule).toBe("manual-priority");
    expect(result.fixed.metrics.recoveryActions).toBe(0);
    for (const durationTicks of [0, 1.5, base.scenario.config.maxTicks + 1]) expect(() => runAutopilotExperiment({ ...base, durationTicks }, "autopilot")).toThrow(/horizon/);
    expect(() => compareAutopilot({ ...base, runbook: [{ tick: 6, serviceId: "identity" }] })).toThrow(/limited/);
    expect(() => compareAutopilot({ ...base, failures: [{ tick: 2, serviceId: "missing" }] })).toThrow(/Unknown/);
    expect(() => compareAutopilot({ ...base, runbook: [...base.runbook, base.runbook[0]!] })).toThrow(/duplicate/);
    expect(() => compareAutopilot({ ...base, scenario: { ...base.scenario, retry: undefined } })).toThrow(/retry accounting/);
  });
});
