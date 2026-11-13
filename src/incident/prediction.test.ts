import { describe, expect, it } from "vitest";
import { createAppState, reduceAppState } from "../appState";
import { failchainScenario } from "../scenarios/failchain";
import { createResilienceExperiment } from "../scenarios/resurrection";
import { createIncidentState, reduceIncidentState } from "./incidentState";
import { predictIncident, PRESENTATION_STEP_MS } from "./prediction";

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
}

describe("bounded incident prediction", () => {
  it("uses future engine transitions and converts their step distance to playback seconds", () => {
    const app = reduceAppState(failchainScenario, createAppState(failchainScenario), { type: "fail" });
    const forecast = predictIncident(failchainScenario, app);
    expect(PRESENTATION_STEP_MS).toBe(2000);
    expect(forecast.fromTick).toBe(1);
    expect(forecast.evaluatedSteps).toBe(6);
    expect(forecast.impacts.find(({ serviceId }) => serviceId === "gateway")).toMatchObject({ status: "offline", stepsAway: 1, atTick: 2, seconds: 2 });
    expect(forecast.impacts.find(({ serviceId }) => serviceId === "calendar")).toMatchObject({ status: "offline", stepsAway: 2, atTick: 3, seconds: 4 });
    expect(forecast.impacts.find(({ serviceId }) => serviceId === "support")).toMatchObject({ status: "degraded", stepsAway: 2, seconds: 4 });
    expect(forecast.impacts.some(({ serviceId }) => serviceId === "billing" || serviceId === "notifications" || serviceId === "identity")).toBe(false);
    let future = app;
    for (let distance = 1; distance <= 6; distance++) {
      future = reduceAppState(failchainScenario, future, { type: "step" });
      for (const impact of forecast.impacts.filter(({ stepsAway }) => stepsAway === distance)) expect(future.simulation.services[impact.serviceId]!.status).toBe(impact.status);
    }
  });

  it("never mutates live state, configuration, queues, breaker, or intervention history", () => {
    const base = createResilienceExperiment();
    const scenario = freezeDeep({ ...base.scenario, retry: { ...base.retry, policy: "adaptive" as const, ...base.adaptive } });
    let app = reduceAppState(scenario, createAppState(scenario), { type: "select", serviceId: "gateway-a" });
    app = reduceAppState(scenario, app, { type: "autopilot", enabled: true });
    app = freezeDeep(reduceAppState(scenario, app, { type: "fail" }));
    const original = structuredClone(app);
    const topology = structuredClone(scenario);
    const first = predictIncident(scenario, app);
    expect(predictIncident(scenario, app)).toEqual(first);
    expect(app).toEqual(original);
    expect(scenario).toEqual(topology);
    expect(app.simulation.tick).toBe(1);
    expect(app.controller.instances["gateway-a"]!.repairActions).toBe(0);
    let future = app;
    for (let distance = 1; distance <= first.evaluatedSteps; distance++) {
      future = reduceAppState(scenario, future, { type: "step" });
      for (const impact of first.impacts.filter(({ stepsAway }) => stepsAway === distance)) expect(future.simulation.services[impact.serviceId]!.status).toBe(impact.status);
    }
  });

  it("reports only worsening impacts, not exposure, recovery, or unavailable guesses", () => {
    const healthy = createAppState(failchainScenario);
    expect(predictIncident(failchainScenario, healthy).impacts).toEqual([]);
    const failed = reduceAppState(failchainScenario, healthy, { type: "fail" });
    const repaired = reduceAppState(failchainScenario, failed, { type: "repair" });
    expect(predictIncident(failchainScenario, repaired).impacts.some(({ serviceId }) => serviceId === "identity")).toBe(false);
    const broken = { ...failchainScenario, config: { ...failchainScenario.config, recoveryTicks: 0 } };
    expect(predictIncident(broken, healthy)).toMatchObject({ impacts: [], unavailable: "Prediction unavailable." });
    expect(predictIncident(failchainScenario, healthy, 99)).toMatchObject({ impacts: [], unavailable: "Prediction unavailable." });
    expect(predictIncident(failchainScenario, healthy, 6, NaN)).toMatchObject({ impacts: [], unavailable: "Prediction unavailable." });
  });

  it("stops at the real horizon and supports an alternate interval without changing engine time", () => {
    const bounded = { ...failchainScenario, config: { ...failchainScenario.config, maxTicks: 2 } };
    const app = reduceAppState(bounded, createAppState(bounded), { type: "fail" });
    const forecast = predictIncident(bounded, app, 6, 1000);
    expect(forecast.evaluatedSteps).toBe(1);
    expect(forecast.impacts.every(({ seconds, atTick }) => seconds === 1 && atTick === 2)).toBe(true);
    expect(predictIncident(bounded, reduceAppState(bounded, app, { type: "step" })).evaluatedSteps).toBe(0);
    expect(app.simulation.tick).toBe(1);
  });

  it("starts/rebases only around confirmed live actions and clears predictions on Reset", () => {
    const initial = createIncidentState(failchainScenario);
    expect(initial.prediction).toBeNull();
    expect(reduceIncidentState(failchainScenario, initial, { type: "app", action: { type: "repair" } }).prediction).toBeNull();
    let state = reduceIncidentState(failchainScenario, initial, { type: "app", action: { type: "fail" } });
    expect(state.app.simulation.tick).toBe(1);
    expect(state.prediction!.fromTick).toBe(1);
    const forecast = state.prediction;
    state = reduceIncidentState(failchainScenario, state, { type: "pause" });
    expect(state.prediction).toBe(forecast);
    state = reduceIncidentState(failchainScenario, state, { type: "resume" });
    state = reduceIncidentState(failchainScenario, state, { type: "playback-tick", sequence: state.sequence, expectedTick: 1 });
    expect(state.app.simulation.tick).toBe(2);
    expect(state.prediction!.fromTick).toBe(2);
    expect(state.prediction!.impacts.find(({ serviceId }) => serviceId === "calendar")!.seconds).toBe(2);
    state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "reset" } });
    expect(state.app.simulation.tick).toBe(0);
    expect(state.prediction).toBeNull();
  });
});

