import { reduceAppState } from "../appState";
import type { AppState } from "../appState";
import type { ServiceStatus, SimulationScenario } from "../simulation/types";

export const PREDICTION_STEPS = 6;
export const PRESENTATION_STEP_MS = 2000;

export interface PredictedImpact {
  readonly serviceId: string;
  readonly status: "degraded" | "offline";
  readonly atTick: number;
  readonly stepsAway: number;
  readonly seconds: number;
}

export interface IncidentPrediction {
  readonly fromTick: number;
  readonly evaluatedSteps: number;
  readonly impacts: readonly PredictedImpact[];
  readonly unavailable?: string;
}

const severity: Record<ServiceStatus, number> = { healthy: 0, degraded: 1, recovering: 2, offline: 2 };

/** Replay the real Step path on owned copies. No graph, live state, or timer is touched. */
export function predictIncident(scenario: SimulationScenario, app: AppState, horizon = PREDICTION_STEPS, intervalMs = PRESENTATION_STEP_MS): IncidentPrediction {
  const empty = { fromTick: app.simulation.tick, evaluatedSteps: 0, impacts: [] };
  if (!Number.isSafeInteger(horizon) || horizon < 1 || horizon > 12 || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return { ...empty, unavailable: "Prediction unavailable." };
  }
  try {
    const ownedScenario = structuredClone(scenario);
    let future = structuredClone(app);
    const impacts = new Map<string, PredictedImpact>();
    const count = Math.min(horizon, Math.max(0, scenario.config.maxTicks - app.simulation.tick));
    for (let stepsAway = 1; stepsAway <= count; stepsAway++) {
      const previous = future.simulation;
      future = reduceAppState(ownedScenario, future, { type: "step" });
      if (future.error || future.simulation.tick !== previous.tick + 1) return { ...empty, unavailable: "Prediction unavailable." };
      for (const event of future.simulation.events.slice(previous.events.length)) {
        if (event.type !== "status-changed" || (event.to !== "degraded" && event.to !== "offline")) continue;
        const initial = app.simulation.services[event.serviceId];
        if (!initial || impacts.has(event.serviceId) || severity[event.to] <= severity[initial.status] || severity[event.to] <= severity[event.from]) continue;
        impacts.set(event.serviceId, { serviceId: event.serviceId, status: event.to, atTick: event.tick,
          stepsAway, seconds: Math.round(stepsAway * intervalMs / 100) / 10 });
      }
    }
    return { fromTick: app.simulation.tick, evaluatedSteps: count,
      impacts: [...impacts.values()].sort((a, b) => a.atTick - b.atTick || (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0)) };
  } catch {
    return { ...empty, unavailable: "Prediction unavailable." };
  }
}
