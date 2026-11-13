import { failService, initializeSimulation, repairService, resetSimulation, step } from "./simulation/engine";
import type { ServiceId, SimulationScenario, SimulationState, WorkloadPresetId } from "./simulation/types";
import { withWorkload } from "./scenarios/workloads";
import { createAutopilotState, DEFAULT_AUTOPILOT_CONFIG, observeAutopilot, stepWithAutopilot, validateAutopilotConfig } from "./simulation/autopilot";
import type { AutopilotConfig, AutopilotState } from "./simulation/autopilot";

export interface AppState {
  readonly simulation: SimulationState;
  readonly selectedId: ServiceId | null;
  readonly error: string | null;
  readonly workloadId: WorkloadPresetId;
  readonly autopilotEnabled: boolean;
  readonly autopilotConfig: AutopilotConfig;
  readonly controller: AutopilotState;
}

export type AppAction =
  | { type: "select"; serviceId: ServiceId }
  | { type: "workload"; workloadId: WorkloadPresetId }
  | { type: "autopilot"; enabled: boolean }
  | { type: "autopilot-cooldown"; cooldownTicks: number }
  | { type: "fail" | "repair" | "step" | "reset" };

export function createAppState(scenario: SimulationScenario): AppState {
  const simulation = initializeSimulation(scenario);
  return {
    simulation,
    selectedId: scenario.nodes[0]?.id ?? null,
    error: null,
    workloadId: scenario.workload?.id ?? "normal",
    autopilotEnabled: false,
    autopilotConfig: DEFAULT_AUTOPILOT_CONFIG,
    controller: createAutopilotState(scenario, simulation),
  };
}

/** UI-only state transitions delegate every simulation change to the Phase 1A engine. */
export function reduceAppState(scenario: SimulationScenario, state: AppState, action: AppAction): AppState {
  try {
    if (action.type === "autopilot") return { ...state, autopilotEnabled: action.enabled, error: null };
    if (action.type === "autopilot-cooldown") {
      const autopilotConfig = { ...state.autopilotConfig, cooldownTicks: action.cooldownTicks };
      validateAutopilotConfig(autopilotConfig, scenario);
      return { ...state, autopilotConfig, error: null };
    }
    if (action.type === "workload") {
      if (!scenario.workload) throw new Error("This scenario has no workload presets.");
      const nextScenario = withWorkload(scenario, action.workloadId);
      const simulation = initializeSimulation(nextScenario);
      return { ...state, workloadId: action.workloadId, simulation, controller: createAutopilotState(nextScenario, simulation), autopilotEnabled: false, error: null };
    }
    const activeScenario = scenario.workload && scenario.workload.id !== state.workloadId
      ? withWorkload(scenario, state.workloadId) : scenario;
    if (action.type === "select") {
      if (!scenario.nodes.some(({ id }) => id === action.serviceId)) throw new Error("Unknown service selection.");
      return { ...state, selectedId: action.serviceId, error: null };
    }
    if (action.type === "reset") {
      const simulation = resetSimulation(activeScenario);
      return { ...state, simulation, controller: createAutopilotState(activeScenario, simulation), autopilotEnabled: false, error: null };
    }
    if (state.simulation.tick >= scenario.config.maxTicks) {
      throw new Error("The tick limit has been reached. Reset to start another experiment.");
    }
    let simulation: SimulationState;
    if (state.autopilotEnabled) {
      if (action.type !== "step" && !state.selectedId) throw new Error("Select a service before applying a command.");
      const next = stepWithAutopilot(activeScenario, state.simulation, state.controller, state.autopilotConfig,
        action.type === "step" ? undefined : { type: action.type, serviceId: state.selectedId! });
      return { ...state, ...next, error: null };
    }
    if (action.type === "step") {
      simulation = step(activeScenario, state.simulation);
    } else {
      if (!state.selectedId) throw new Error("Select a service before applying a command.");
      simulation = action.type === "fail"
        ? failService(activeScenario, state.simulation, state.selectedId)
        : repairService(activeScenario, state.simulation, state.selectedId);
    }
    return { ...state, simulation, controller: observeAutopilot(activeScenario, simulation, state.controller), error: null };
  } catch (error) {
    return { ...state, error: error instanceof Error ? error.message : "The simulation action could not be applied." };
  }
}
