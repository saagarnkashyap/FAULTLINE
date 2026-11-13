import { describe, expect, it } from "vitest";
import { createAppState, reduceAppState } from "./appState";
import { enterpriseScenario as scenario } from "./scenarios/enterprise";
import { withWorkload } from "./scenarios/workloads";
import { failService, initializeSimulation, repairService, resetSimulation, step } from "./simulation/engine";

describe("application actions", () => {
  it("selects either a graph/list service ID without advancing time or producing events", () => {
    const initial = createAppState(scenario);
    const selected = reduceAppState(scenario, initial, { type: "select", serviceId: "calendar" });
    expect(selected.selectedId).toBe("calendar");
    expect(selected.simulation).toBe(initial.simulation);
    expect(selected.simulation.tick).toBe(0);
    expect(selected.simulation.events).toEqual([]);
  });

  it("delegates fail, step, and repair to the existing engine and retains its recovery delay", () => {
    let app = createAppState(scenario);
    const initial = app.simulation;
    app = reduceAppState(scenario, app, { type: "fail" });
    expect(app.simulation).toEqual(failService(scenario, initial, "identity"));
    expect(app.simulation.tick).toBe(1);
    const failed = app.simulation;
    app = reduceAppState(scenario, app, { type: "step" });
    expect(app.simulation).toEqual(step(scenario, failed));
    expect(app.simulation.services.gateway?.status).toBe("offline");
    const propagated = app.simulation;
    app = reduceAppState(scenario, app, { type: "repair" });
    expect(app.simulation).toEqual(repairService(scenario, propagated, "identity"));
    expect(app.simulation.services.identity?.local).toEqual({ kind: "recovering", readyAtTick: 5 });
    app = reduceAppState(scenario, app, { type: "step" });
    expect(app.simulation.services.identity?.status).toBe("recovering");
    app = reduceAppState(scenario, app, { type: "step" });
    expect(app.simulation.tick).toBe(5);
    expect(app.simulation.services.identity?.status).toBe("healthy");
    expect(app.simulation.services.gateway?.status).toBe("offline");
  });

  it("shows readable command errors and preserves the exact snapshot on rejection", () => {
    const initial = createAppState(scenario);
    const invalidRepair = reduceAppState(scenario, initial, { type: "repair" });
    expect(invalidRepair.error).toMatch(/Only a locally failed service/);
    expect(invalidRepair.simulation).toBe(initial.simulation);
    const failed = reduceAppState(scenario, initial, { type: "fail" });
    const repeated = reduceAppState(scenario, failed, { type: "fail" });
    expect(repeated.error).toMatch(/already locally failed/);
    expect(repeated.simulation).toBe(failed.simulation);
    const selected = reduceAppState(scenario, failed, { type: "select", serviceId: "gateway" });
    const dependencyOnly = reduceAppState(scenario, reduceAppState(scenario, selected, { type: "step" }), { type: "repair" });
    expect(dependencyOnly.error).toMatch(/locally failed/);
  });

  it("handles empty/invalid selections and clears errors after a valid action", () => {
    const initial = createAppState(scenario);
    const noSelection = reduceAppState(scenario, { ...initial, selectedId: null }, { type: "fail" });
    expect(noSelection.error).toMatch(/Select a service/);
    expect(noSelection.simulation).toBe(initial.simulation);
    const invalidSelection = reduceAppState(scenario, initial, { type: "select", serviceId: "missing" });
    expect(invalidSelection.error).toMatch(/Unknown service/);
    expect(invalidSelection.selectedId).toBe(initial.selectedId);
    expect(reduceAppState(scenario, invalidSelection, { type: "step" }).error).toBeNull();
  });

  it("resets simulation and log through the engine while retaining selection", () => {
    const failed = reduceAppState(scenario, createAppState(scenario), { type: "fail" });
    const stateCopy = structuredClone(failed);
    const reset = reduceAppState(scenario, { ...failed, error: "old error" }, { type: "reset" });
    expect(reset.simulation).toEqual(resetSimulation(scenario));
    expect(reset.selectedId).toBe(failed.selectedId);
    expect(reset.error).toBeNull();
    expect(failed).toEqual(stateCopy);
  });

  it("prevents advancing beyond the configured limit but allows reset", () => {
    const bounded = { ...scenario, config: { ...scenario.config, maxTicks: 1 } };
    const final = reduceAppState(bounded, createAppState(bounded), { type: "step" });
    for (const type of ["step", "fail", "repair"] as const) {
      const rejected = reduceAppState(bounded, final, { type });
      expect(rejected.simulation).toBe(final.simulation);
      expect(rejected.error).toMatch(/tick limit/);
    }
    expect(reduceAppState(bounded, final, { type: "reset" }).simulation.tick).toBe(0);
  });

  it("completes Fail -> Step -> Repair -> Step -> Reset without skipping recovery", () => {
    const initial = createAppState(scenario);
    let app = reduceAppState(scenario, initial, { type: "fail" });
    expect(app.simulation.tick).toBe(1);
    expect(app.simulation.services.identity?.status).toBe("offline");
    app = reduceAppState(scenario, app, { type: "step" });
    expect(app.simulation.tick).toBe(2);
    expect(app.simulation.services.gateway?.status).toBe("offline");
    app = reduceAppState(scenario, app, { type: "repair" });
    expect(app.simulation.tick).toBe(3);
    expect(app.simulation.services.identity?.local).toEqual({ kind: "recovering", readyAtTick: 5 });
    app = reduceAppState(scenario, app, { type: "step" });
    expect(app.simulation.tick).toBe(4);
    expect(app.simulation.services.identity?.status).toBe("recovering");
    expect(app.simulation.events.length).toBeGreaterThan(0);
    app = reduceAppState(scenario, app, { type: "reset" });
    expect(app).toEqual(initial);
  });

  it("selects a workload by explicitly resetting the run and keeps it on subsequent reset", () => {
    const initial = createAppState(scenario);
    let app = reduceAppState(scenario, initial, { type: "fail" });
    app = reduceAppState(scenario, app, { type: "workload", workloadId: "spike" });
    expect(app.workloadId).toBe("spike");
    expect(app.selectedId).toBe(initial.selectedId);
    expect(app.simulation).toEqual(initializeSimulation(withWorkload(scenario, "spike")));
    expect(app.simulation.tick).toBe(0);
    expect(app.simulation.events).toEqual([]);
    expect(app.simulation.services.identity?.local).toEqual({ kind: "ready" });
    for (let i = 0; i < 3; i += 1) app = reduceAppState(scenario, app, { type: "step" });
    expect(app.simulation.services.gateway?.status).toBe("offline");
    app = reduceAppState(scenario, app, { type: "reset" });
    expect(app.workloadId).toBe("spike");
    expect(app.simulation.services.gateway?.traffic?.offeredDemandPerTick).toBe(360);
    expect(app.simulation.services.gateway?.traffic?.consecutiveOverloadedTicks).toBe(0);
    app = reduceAppState(scenario, app, { type: "workload", workloadId: "normal" });
    expect(app).toEqual(initial);
  });
});
