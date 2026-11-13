import { createAutopilotState, decideAutopilot, observeAutopilot, repairEligibility, validateAutopilotConfig } from "./autopilot";
import type { AutopilotConfig, AutopilotDecision, AutopilotState } from "./autopilot";
import { initializeSimulation, step } from "./engine";
import type { SimulationCommand, SimulationScenario, SimulationState } from "./types";

export interface AutopilotExperiment {
  readonly scenario: SimulationScenario; // Includes the same retry/breaker configuration for both runs.
  readonly durationTicks: number;
  readonly controller: AutopilotConfig;
  readonly failures: readonly { readonly tick: number; readonly serviceId: string }[];
  readonly runbook: readonly { readonly tick: number; readonly serviceId: string }[];
}

export interface AutopilotMetrics {
  readonly recoveryActions: number;
  readonly failedRecoveryAttempts: number;
  readonly repeatedInstanceFailures: number;
  readonly offlineServiceTicks: number;
  readonly completedUniqueRequests: number;
  readonly abandonedRequests: number;
  readonly pendingRequests: number;
  readonly stableRecoveryTick: number | null;
  readonly stableRecoveryAchieved: boolean;
}

export interface AutopilotRun {
  readonly policy: "fixed-runbook" | "autopilot";
  readonly initialState: SimulationState;
  readonly finalState: SimulationState;
  readonly controller: AutopilotState;
  readonly metrics: AutopilotMetrics;
}

export interface AutopilotComparison { readonly fixed: AutopilotRun; readonly autopilot: AutopilotRun }

function scheduleMap(entries: AutopilotExperiment["runbook"], experiment: AutopilotExperiment, repairs: boolean): Map<number, string> {
  const result = new Map<number, string>();
  for (const { tick, serviceId } of entries) {
    if (!Number.isSafeInteger(tick) || tick < 1 || tick > experiment.durationTicks || result.has(tick)) throw new Error("Invalid or duplicate AUTOPILOT experiment schedule tick.");
    if (!experiment.scenario.nodes.some(({ id }) => id === serviceId)) throw new Error("Unknown scheduled service.");
    if (repairs && !experiment.scenario.routingPool!.memberIds.includes(serviceId)) throw new Error("Runbook repairs are limited to gateway instances.");
    result.set(tick, serviceId);
  }
  return result;
}

/** A runner around the existing engine, not another simulation algorithm. */
export function runAutopilotExperiment(experiment: AutopilotExperiment, policy: AutopilotRun["policy"]): AutopilotRun {
  const scenario = experiment.scenario;
  if (!scenario.routingPool || !scenario.retry) throw new Error("AUTOPILOT comparison requires a gateway pool and retry accounting.");
  if (!Number.isSafeInteger(experiment.durationTicks) || experiment.durationTicks < 1 || experiment.durationTicks > scenario.config.maxTicks) throw new Error("Invalid AUTOPILOT experiment horizon.");
  validateAutopilotConfig(experiment.controller, scenario);
  const failures = scheduleMap(experiment.failures, experiment, false);
  const runbook = scheduleMap(experiment.runbook, experiment, true);
  const initialState = initializeSimulation(scenario);
  let simulation = initialState;
  let controller = createAutopilotState(scenario, simulation);
  let offlineServiceTicks = 0;
  for (let tick = 1; tick <= experiment.durationTicks; tick += 1) {
    const failure = failures.get(tick);
    const scheduledRepair = runbook.get(tick);
    let decision: AutopilotDecision;
    let command: SimulationCommand | undefined;
    if (failure) {
      decision = { tick, action: "wait", rule: "manual-priority", reason: `Shared failure injection ${failure} takes this tick; no repair permitted.` };
      command = { type: "fail", serviceId: failure };
    } else if (policy === "autopilot") {
      decision = decideAutopilot(scenario, simulation, controller, experiment.controller);
    } else if (scheduledRepair) {
      const rejection = repairEligibility(scenario, simulation, controller, experiment.controller, scheduledRepair);
      decision = rejection ? { tick, action: "wait", ...rejection }
        : { tick, action: "repair", serviceId: scheduledRepair, rule: "local-failure", reason: `Fixed runbook slot for ${scheduledRepair}; shared cooldown and budgets permit repair.` };
    } else {
      decision = { tick, action: "wait", rule: "runbook-wait", reason: "No repair scheduled in the fixed runbook this tick." };
    }
    if (decision.action === "repair") command = { type: "repair", serviceId: decision.serviceId! };
    simulation = step(scenario, simulation, command);
    controller = observeAutopilot(scenario, simulation, { ...controller, decisions: [...controller.decisions, decision] });
    offlineServiceTicks += Object.values(simulation.services).filter(({ status }) => status === "offline").length;
  }
  const histories = Object.values(controller.instances);
  const retry = simulation.retry!;
  return { policy, initialState, finalState: simulation, controller, metrics: {
    recoveryActions: histories.reduce((sum, instance) => sum + instance.repairActions, 0),
    failedRecoveryAttempts: histories.reduce((sum, instance) => sum + instance.failedRecoveryAttempts, 0),
    repeatedInstanceFailures: histories.reduce((sum, instance) => sum + Math.max(0, instance.failures - 1), 0),
    offlineServiceTicks, completedUniqueRequests: retry.totalCompletedRequests,
    abandonedRequests: retry.totalAbandonedRequests, pendingRequests: retry.pendingRequests,
    stableRecoveryTick: retry.stableRecoveryTick, stableRecoveryAchieved: retry.stableRecoveryTick !== null,
  } };
}

export function compareAutopilot(experiment: AutopilotExperiment): AutopilotComparison {
  return { fixed: runAutopilotExperiment(experiment, "fixed-runbook"), autopilot: runAutopilotExperiment(experiment, "autopilot") };
}
