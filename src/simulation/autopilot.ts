import { step } from "./engine";
import type { SimulationCommand, SimulationScenario, SimulationState } from "./types";

export interface AutopilotConfig {
  readonly cooldownTicks: number;
  readonly maxRepairsPerInstance: number;
  readonly maxInterventions: number;
}

export const DEFAULT_AUTOPILOT_CONFIG: AutopilotConfig = {
  cooldownTicks: 2, maxRepairsPerInstance: 2, maxInterventions: 4,
};

export interface InstanceHistory {
  readonly failedAtTick: number | null;
  readonly cause: "manual" | "overload" | null;
  readonly failures: number;
  readonly repairActions: number;
  readonly lastRepairTick: number | null;
  readonly repairSinceLastFailure: boolean;
  readonly failedRecoveryAttempts: number;
}

export type AutopilotRule = "pool-unavailable" | "pool-degraded" | "local-failure"
  | "cooldown" | "budget-exhausted" | "restart-in-progress" | "no-local-failure"
  | "tick-limit" | "manual-priority" | "runbook-wait";

export interface AutopilotDecision {
  readonly tick: number; // The next engine tick; observations use only the current snapshot.
  readonly action: "repair" | "wait";
  readonly serviceId?: string;
  readonly rule: AutopilotRule;
  readonly reason: string;
}

export interface AutopilotState {
  readonly observedEventCount: number;
  readonly instances: Readonly<Record<string, InstanceHistory>>;
  readonly decisions: readonly AutopilotDecision[];
}

export function validateAutopilotConfig(config: AutopilotConfig, scenario?: SimulationScenario): void {
  for (const [key, value] of Object.entries(config)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`AUTOPILOT ${key} must be a nonnegative safe integer.`);
  }
  if (scenario && !Number.isSafeInteger(scenario.config.maxTicks + config.cooldownTicks + 1)) throw new Error("AUTOPILOT cooldown exceeds safe tick limits.");
}

/** Observe factual engine events, including manual interventions; never infer a repair success. */
export function observeAutopilot(scenario: SimulationScenario, simulation: SimulationState, previous: AutopilotState): AutopilotState {
  if (previous.observedEventCount === simulation.events.length) return previous;
  const instances = { ...previous.instances };
  for (const event of simulation.events.slice(previous.observedEventCount)) {
    const history = instances[event.serviceId];
    if (!history || !scenario.routingPool?.memberIds.includes(event.serviceId)) continue;
    if (event.type === "overload-failed" || (event.type === "command-applied" && event.command === "fail")) {
      instances[event.serviceId] = { ...history, failedAtTick: event.tick,
        cause: event.type === "overload-failed" ? "overload" : "manual", failures: history.failures + 1,
        failedRecoveryAttempts: history.failedRecoveryAttempts + (history.repairSinceLastFailure ? 1 : 0), repairSinceLastFailure: false };
    } else if (event.type === "command-applied" && event.command === "repair") {
      instances[event.serviceId] = { ...history, failedAtTick: null, cause: null,
        repairActions: history.repairActions + 1, lastRepairTick: event.tick, repairSinceLastFailure: true };
    }
  }
  return { ...previous, instances, observedEventCount: simulation.events.length };
}

export function createAutopilotState(scenario: SimulationScenario, simulation: SimulationState): AutopilotState {
  const instances = Object.fromEntries((scenario.routingPool?.memberIds ?? []).map((id) => [id, {
    failedAtTick: null, cause: null, failures: 0, repairActions: 0, lastRepairTick: null,
    repairSinceLastFailure: false, failedRecoveryAttempts: 0,
  } satisfies InstanceHistory]));
  return observeAutopilot(scenario, simulation, { instances, observedEventCount: 0, decisions: [] });
}

/** C complete ticks after failure/intervention must pass before another repair tick. */
export function nextRepairTick(history: InstanceHistory, config: AutopilotConfig): number | null {
  if (history.failedAtTick === null) return null;
  return Math.max(history.failedAtTick, history.lastRepairTick ?? 0) + config.cooldownTicks + 1;
}

/** Shared eligibility gate for AUTOPILOT and the fixed runbook. */
export function repairEligibility(scenario: SimulationScenario, simulation: SimulationState, state: AutopilotState, config: AutopilotConfig, serviceId: string): { rule: AutopilotRule; reason: string } | null {
  const history = state.instances[serviceId];
  if (!scenario.routingPool?.memberIds.includes(serviceId) || !history || simulation.services[serviceId]?.local.kind !== "failed") {
    return { rule: "no-local-failure", reason: `${serviceId} is not a locally failed gateway instance; dependency-only outages cannot be repaired.` };
  }
  const total = Object.values(state.instances).reduce((sum, item) => sum + item.repairActions, 0);
  if (total >= config.maxInterventions || history.repairActions >= config.maxRepairsPerInstance) {
    return { rule: "budget-exhausted", reason: `${serviceId}: finite repair budget exhausted.` };
  }
  const eligibleTick = nextRepairTick(history, config);
  if (eligibleTick === null || simulation.tick + 1 < eligibleTick) {
    return { rule: "cooldown", reason: `${serviceId}: ${history.cause} local failure${history.failures > 1 ? " detected again after repair" : " detected"}; cooldown; earliest repair tick ${eligibleTick ?? "unknown"}.` };
  }
  return null;
}

export function decideAutopilot(scenario: SimulationScenario, simulation: SimulationState, previous: AutopilotState, config: AutopilotConfig = DEFAULT_AUTOPILOT_CONFIG): AutopilotDecision {
  validateAutopilotConfig(config, scenario);
  const state = observeAutopilot(scenario, simulation, previous);
  const tick = simulation.tick + 1;
  if (simulation.tick >= scenario.config.maxTicks) return { tick: simulation.tick, action: "wait", rule: "tick-limit", reason: "Tick limit reached; reset to continue." };
  const failed = Object.keys(state.instances).filter((id) => simulation.services[id]?.local.kind === "failed").sort();
  let blocked: ReturnType<typeof repairEligibility> = null;
  for (const serviceId of failed) {
    const rejection = repairEligibility(scenario, simulation, state, config, serviceId);
    if (rejection) { blocked ??= rejection; continue; }
    const rule = simulation.routingPool?.status === "offline" ? "pool-unavailable"
      : simulation.routingPool?.status === "degraded" ? "pool-degraded" : "local-failure";
    const history = state.instances[serviceId]!;
    return { tick, action: "repair", serviceId, rule,
      reason: `${serviceId}: ${history.cause} local failure${history.failures > 1 ? " detected again after repair" : " detected"}; cooldown elapsed; ${rule}. Stable service ID breaks ties.` };
  }
  if (blocked) return { tick, action: "wait", ...blocked };
  const recovering = Object.keys(state.instances).some((id) => simulation.services[id]?.local.kind === "recovering");
  return { tick, action: "wait", rule: recovering ? "restart-in-progress" : "no-local-failure",
    reason: recovering ? "Restart in progress; engine recovery delay still applies." : "No locally failed gateway instance is eligible. Dependency-only unavailability needs its provider restored." };
}

/** Integration boundary: at most one ordinary engine command, never direct status writes. */
export function stepWithAutopilot(scenario: SimulationScenario, simulation: SimulationState, previous: AutopilotState, config: AutopilotConfig = DEFAULT_AUTOPILOT_CONFIG, manualCommand?: SimulationCommand): { simulation: SimulationState; controller: AutopilotState } {
  if (simulation.tick >= scenario.config.maxTicks) return { simulation, controller: previous };
  const observed = observeAutopilot(scenario, simulation, previous);
  const decision: AutopilotDecision = manualCommand
    ? { tick: simulation.tick + 1, action: "wait", rule: "manual-priority", reason: `Explicit manual ${manualCommand.type} ${manualCommand.serviceId} takes this tick; controller takes no action.` }
    : decideAutopilot(scenario, simulation, observed, config);
  const command = manualCommand ?? (decision.action === "repair" ? { type: "repair" as const, serviceId: decision.serviceId! } : undefined);
  const next = step(scenario, simulation, command);
  const controller = observeAutopilot(scenario, next, { ...observed, decisions: [...observed.decisions, decision] });
  return { simulation: next, controller };
}
