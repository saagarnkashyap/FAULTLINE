import { useCallback, useEffect, useReducer } from "react";
import type { AppAction } from "../appState";
import { createIncidentState, reduceIncidentState } from "../incident/incidentState";
import type { SimulationScenario } from "../simulation/types";

export const PLAYBACK_INTERVAL_MS = 800;

/** One cancellable presentation callback; exported for fake-timer lifecycle tests. */
export function scheduleIncidentTick(advance: () => void): () => void {
  let active = true;
  const timer = setTimeout(() => { if (active) advance(); }, PLAYBACK_INTERVAL_MS);
  return () => { active = false; clearTimeout(timer); };
}

export function useIncidentPlayback(scenario: SimulationScenario) {
  const [state, dispatch] = useReducer((previous: ReturnType<typeof createIncidentState>, action: Parameters<typeof reduceIncidentState>[2]) =>
    reduceIncidentState(scenario, previous, action), scenario, createIncidentState);
  const phase = state.incident?.phase;
  const tick = state.app.simulation.tick;
  const sequence = state.sequence;
  useEffect(() => {
    if (phase !== "running") return;
    return scheduleIncidentTick(() => dispatch({ type: "playback-tick", sequence, expectedTick: tick }));
  }, [phase, sequence, tick]);
  const dispatchApp = useCallback((action: AppAction) => dispatch({ type: "app", action }), []);
  return { state, dispatch, dispatchApp };
}
