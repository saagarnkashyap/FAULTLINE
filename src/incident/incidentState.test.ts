import { describe, expect, it } from "vitest";
import { reduceAppState } from "../appState";
import { failchainScenario } from "../scenarios/failchain";
import { createResilienceExperiment } from "../scenarios/resurrection";
import { CRITICAL_IMPACT_THRESHOLD, createIncidentState, currentImpact, INCIDENT_ALERT_LIMIT, INCIDENT_TICK_CAP, incidentExposure, incidentOngoing, reduceIncidentState, safeToSettle } from "./incidentState";
import type { IncidentState } from "./incidentState";
import type { SimulationScenario } from "../simulation/types";

function inject(scenario: SimulationScenario = failchainScenario, id = "identity", state = createIncidentState(scenario)) {
  return reduceIncidentState(scenario, reduceIncidentState(scenario, state, { type: "app", action: { type: "select", serviceId: id } }), { type: "app", action: { type: "fail" } });
}
function tick(state: IncidentState, scenario = failchainScenario) {
  return reduceIncidentState(scenario, state, { type: "playback-tick", sequence: state.sequence, expectedTick: state.app.simulation.tick });
}
function resilienceScenario(): SimulationScenario {
  const experiment = createResilienceExperiment();
  return { ...experiment.scenario, retry: { ...experiment.retry, policy: "adaptive", ...experiment.adaptive } };
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
}

describe("INCIDENT ZERO lifecycle", () => {
  it("starts only after the engine confirms a fail command and advances exactly one tick per callback", () => {
    const state = inject();
    expect(state.incident).toMatchObject({ triggerId: "identity", startedAtTick: 1, phase: "running" });
    expect(state.incident!.alerts[0]).toMatchObject({ level: "injection", title: "FAULT INJECTED — Identity offline" });
    expect(state.app.simulation.services.identity!.local.kind).toBe("failed");
    const next = tick(state);
    expect(next.app.simulation.tick).toBe(2);
    expect(next.app.simulation).toEqual(reduceAppState(failchainScenario, state.app, { type: "step" }).simulation);
  });

  it("does not start on invalid commands, missing selections, or max tick failures", () => {
    const initial = createIncidentState(failchainScenario);
    const invalidRepair = reduceIncidentState(failchainScenario, initial, { type: "app", action: { type: "repair" } });
    expect(invalidRepair.incident).toBeNull();
    const missing = reduceIncidentState(failchainScenario, { ...initial, app: { ...initial.app, selectedId: null } }, { type: "app", action: { type: "fail" } });
    expect(missing.incident).toBeNull();
    expect(missing.app.error).toMatch(/Select/);
    const state = inject();
    const invalid = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "fail" } });
    expect(invalid.app.simulation).toBe(state.app.simulation);
    expect(invalid.incident!.startedAtTick).toBe(1);
    expect(invalid.incident!.phase).toBe("paused");
    expect(invalid.incident!.alerts).toEqual(state.incident!.alerts);
    const bounded = { ...failchainScenario, config: { ...failchainScenario.config, maxTicks: 1 } };
    let last = reduceIncidentState(bounded, createIncidentState(bounded), { type: "app", action: { type: "step" } });
    last = reduceIncidentState(bounded, last, { type: "app", action: { type: "fail" } });
    expect(last.incident).toBeNull();
    expect(last.app.error).toMatch(/tick limit/);
  });

  it("supports manual-only failure, pause/resume, and invalidates stale callbacks", () => {
    const initial = reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "playback-mode", automatic: false });
    const manual = inject(failchainScenario, "identity", initial);
    expect(manual.incident!.phase).toBe("paused");
    expect(tick(manual)).toBe(manual);
    const resumed = reduceIncidentState(failchainScenario, manual, { type: "resume" });
    const advanced = tick(resumed);
    expect(advanced.app.simulation.tick).toBe(2);
    expect(reduceIncidentState(failchainScenario, advanced, { type: "playback-tick", sequence: resumed.sequence, expectedTick: 1 })).toBe(advanced);
    const paused = reduceIncidentState(failchainScenario, advanced, { type: "pause" });
    expect(paused.app.simulation).toBe(advanced.app.simulation);
    expect(reduceIncidentState(failchainScenario, paused, { type: "playback-tick", sequence: advanced.sequence, expectedTick: 2 })).toBe(paused);
  });

  it("stops a settled cascade without claiming recovery and keeps manual repairs/steps functional", () => {
    let state = reduceIncidentState(failchainScenario, inject(), { type: "skip" });
    expect(state.incident).toMatchObject({ phase: "ended", stopReason: "quiet", quietTicks: 2 });
    expect(state.app.simulation.tick).toBe(6);
    expect(incidentOngoing(state.app.simulation)).toBe(true);
    const count = state.incident!.alerts.length;
    state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "step" } });
    expect(state.app.simulation.tick).toBe(7);
    expect(state.incident!.alerts).toHaveLength(count);
    state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "repair" } });
    expect(state.app.simulation.services.identity!.local.kind).toBe("recovering");
    expect(state.incident!.alerts.some(({ level }) => level === "recovery")).toBe(false);
    for (let index = 0; index < 6; index++) state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "step" } });
    expect(incidentOngoing(state.app.simulation)).toBe(false);
    expect(state.incident!.alerts.some(({ level, title }) => level === "recovery" && title.includes("Identity healthy"))).toBe(true);
  });

  it("pauses before manual commands without dropping them and starts a fresh sequence on another valid fail", () => {
    let state = inject();
    const old = state;
    state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "repair" } });
    expect(state.incident!.phase).toBe("paused");
    expect(state.app.simulation.tick).toBe(2);
    expect(state.app.simulation.events.at(-1)).toBeDefined();
    expect(state.app.simulation.services.identity!.local).toEqual({ kind: "recovering", readyAtTick: 4 });
    expect(reduceIncidentState(failchainScenario, state, { type: "playback-tick", sequence: old.sequence, expectedTick: 1 })).toBe(state);
    state = inject(failchainScenario, "email", state);
    expect(state.incident!.triggerId).toBe("email");
    expect(state.incident!.startedAtTick).toBe(3);
    expect(state.incident!.alerts.filter(({ level }) => level === "injection")).toHaveLength(1);
    expect(state.sequence).toBeGreaterThan(old.sequence);
  });

  it("preserves playback while selecting, cancels on reset/workload, and retains manual mode preference", () => {
    let state = inject();
    const selected = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "select", serviceId: "calendar" } });
    expect(selected.sequence).toBe(state.sequence);
    expect(selected.incident!.phase).toBe("running");
    for (const action of [{ type: "reset" } as const, { type: "workload", workloadId: "spike" } as const]) {
      const reset = reduceIncidentState(failchainScenario, selected, { type: "app", action });
      expect(reset.incident).toBeNull();
      expect(reset.app.simulation.tick).toBe(0);
      expect(tick(reset)).toBe(reset);
    }
    state = reduceIncidentState(failchainScenario, state, { type: "playback-mode", automatic: false });
    state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "reset" } });
    expect(state.automatic).toBe(false);
  });

  it("caps delayed retry incidents instead of calling two quiet ticks resolution", () => {
    const scenario = resilienceScenario();
    const state = reduceIncidentState(scenario, inject(scenario), { type: "skip" });
    expect(state.app.simulation.tick).toBe(1 + INCIDENT_TICK_CAP);
    expect(state.incident).toMatchObject({ phase: "ended", stopReason: "cap" });
    expect(state.app.simulation.retry!.pendingRequests).toBeGreaterThan(0);
    expect(incidentOngoing(state.app.simulation)).toBe(true);
    expect(reduceIncidentState(scenario, state, { type: "resume" })).toBe(state);
    expect(reduceIncidentState(scenario, state, { type: "skip" })).toBe(state);
  });

  it("Skip and normal playback produce identical snapshots and alerts, respecting maxTicks", () => {
    const scenario = { ...failchainScenario, config: { ...failchainScenario.config, maxTicks: 3 } };
    const initial = inject(scenario);
    const skipped = reduceIncidentState(scenario, initial, { type: "skip" });
    let played = initial;
    while (played.incident!.phase === "running") played = tick(played, scenario);
    expect(skipped.app).toEqual(played.app);
    expect(skipped.incident).toEqual(played.incident);
    expect(played.app.simulation.tick).toBe(3);
    expect(played.incident!.stopReason).toBe("max-ticks");
    const injectionAtLimit = inject({ ...scenario, config: { ...scenario.config, maxTicks: 1 } });
    expect(injectionAtLimit.incident!.stopReason).toBe("max-ticks");
  });

  it("preserves AUTOPILOT decisions, enabled state, and local repair delays on automatic ticks", () => {
    let initial = createIncidentState(failchainScenario);
    initial = reduceIncidentState(failchainScenario, initial, { type: "app", action: { type: "autopilot", enabled: true } });
    let state = inject(failchainScenario, "gateway-a", initial);
    let manual = state.app;
    for (let index = 0; index < 7; index++) {
      manual = reduceAppState(failchainScenario, manual, { type: "step" });
      state = tick(state);
      expect(state.app).toEqual(manual);
      expect(state.app.autopilotEnabled).toBe(true);
    }
    expect(state.app.controller.decisions.some(({ action }) => action === "repair")).toBe(true);
    const disabled = inject(failchainScenario, "gateway-a");
    expect(tick(disabled).app.autopilotEnabled).toBe(false);
    const changed = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "autopilot", enabled: false } });
    expect(changed.incident!.phase).toBe("paused");
  });

  it("does not settle over delayed restart, overload streak, retry due-time, or controller cooldown", () => {
    const state = inject(failchainScenario, "gateway-a");
    expect(safeToSettle(failchainScenario, state.app)).toBe(false);
    let app = reduceAppState(failchainScenario, inject().app, { type: "repair" });
    expect(safeToSettle(failchainScenario, app)).toBe(false);
    app = reduceAppState(failchainScenario, inject().app, { type: "autopilot", enabled: true });
    // Gateway members become dependency-blocked after Identity; they need no local repair.
    app = reduceAppState(failchainScenario, app, { type: "step" });
    expect(safeToSettle(failchainScenario, app)).toBe(true); // Dependency-only local ready members are not repair targets.
    const failedMember = reduceAppState(failchainScenario, state.app, { type: "autopilot", enabled: true });
    expect(safeToSettle(failchainScenario, failedMember)).toBe(false);
    const retryScenario = resilienceScenario();
    expect(safeToSettle(retryScenario, tick(inject(retryScenario), retryScenario).app)).toBe(false);
  });

  it("waits for a cooling second member even when the first member has exhausted its repair budget", () => {
    let state = inject(failchainScenario, "gateway-a");
    state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "repair" } });
    state = inject(failchainScenario, "gateway-a", state);
    state = { ...state, app: { ...state.app, autopilotEnabled: true,
      autopilotConfig: { ...state.app.autopilotConfig, cooldownTicks: 8, maxRepairsPerInstance: 1 } } };
    expect(state.app.controller.instances["gateway-a"]!.repairActions).toBe(1);
    expect(state.app.controller.instances["gateway-b"]!.repairActions).toBe(0);
    expect(state.app.controller.instances["gateway-b"]!.failedAtTick).toBe(3);
    expect(safeToSettle(failchainScenario, state.app)).toBe(false);
    state = reduceIncidentState(failchainScenario, state, { type: "skip" });
    expect(state.app.simulation.events.some((event) => event.type === "command-applied" && event.command === "repair" && event.serviceId === "gateway-b" && event.tick === 12)).toBe(true);
  });
});

describe("event-driven impact and warnings", () => {
  it("uses actual status events for dependency alerts, with no repeats on unchanged status", () => {
    let state = inject();
    expect(state.incident!.alerts.filter(({ level }) => level === "impact")).toHaveLength(0);
    state = tick(state);
    expect(state.incident!.alerts.find(({ title }) => title === "DEPENDENCY IMPACT — API Gateway offline")?.detail).toBe("Cause: Identity");
    state = reduceIncidentState(failchainScenario, state, { type: "skip" });
    const stateChanges = state.app.simulation.events.filter((event) => event.type === "status-changed");
    for (const alert of state.incident!.alerts.filter(({ level }) => level === "impact")) {
      expect(stateChanges.some((event) => event.tick === alert.tick && event.serviceId === alert.serviceId)).toBe(true);
    }
    expect(new Set(state.incident!.alerts.map(({ id }) => id)).size).toBe(state.incident!.alerts.length);
    const afterQuiet = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "step" } });
    expect(afterQuiet.incident!.alerts).toEqual(state.incident!.alerts);
  });

  it("classifies critical impact at six currently degraded/offline services and alerts once per crossing", () => {
    const first = inject();
    expect(CRITICAL_IMPACT_THRESHOLD).toBe(6);
    expect(first.incident!.criticalActive).toBe(false);
    const second = tick(first);
    expect(currentImpact(second.app.simulation).affectedCount).toBe(6);
    expect(second.incident!.alerts.filter(({ level }) => level === "critical")).toHaveLength(1);
    const final = reduceIncidentState(failchainScenario, second, { type: "skip" });
    expect(final.incident!.alerts.filter(({ level }) => level === "critical")).toHaveLength(1);
    expect(final.incident!.peakAffected).toBe(10);
    expect(final.incident!.affectedIds).not.toContain("billing");
  });

  it("distinguishes exposure from confirmed failure, including optional and redundant pool paths", () => {
    const initial = inject();
    expect(initial.incident!.affectedIds).toEqual(["identity"]);
    expect(initial.incident!.exposureIds).toContain("calendar");
    expect(initial.app.simulation.services.calendar!.status).toBe("healthy");
    expect(incidentExposure(failchainScenario, "gateway-a")).toContain("gateway");
    const healthyRedundancy = inject(failchainScenario, "gateway-a");
    expect(healthyRedundancy.app.simulation.services.calendar!.status).toBe("healthy");
    expect(incidentExposure(failchainScenario, "notifications")).toEqual(["billing"]);
    expect(incidentExposure(failchainScenario, "billing")).toEqual([]);
  });

  it("bounds retained notice history and keeps engine/scenario/prior UI states immutable", () => {
    const scenario = freezeDeep(structuredClone(failchainScenario));
    let state = inject(scenario);
    const copy = structuredClone(state);
    freezeDeep(state);
    const next = tick(state, scenario);
    expect(state).toEqual(copy);
    expect(next.app.simulation.tick).toBe(2);
    state = reduceIncidentState(scenario, next, { type: "pause" });
    for (let index = 0; index < 12; index++) {
      state = reduceIncidentState(scenario, state, { type: "app", action: { type: "repair" } });
      for (let step = 0; step < 5; step++) state = reduceIncidentState(scenario, state, { type: "app", action: { type: "step" } });
      // Re-fail directly via the existing app reducer to keep a single presentation session.
      const app = reduceAppState(scenario, state.app, { type: "fail" });
      state = { ...state, app };
      for (let step = 0; step < 4; step++) state = reduceIncidentState(scenario, state, { type: "app", action: { type: "step" } });
    }
    expect(state.incident!.alerts.length).toBeLessThanOrEqual(INCIDENT_ALERT_LIMIT);
    expect(state.incident!.alerts.length).toBe(INCIDENT_ALERT_LIMIT);
  });
});
