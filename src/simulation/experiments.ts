import { initializeSimulation, step } from "./engine";
import type { BackoffConfig, CircuitBreakerConfig, RetryConfig, RetryPolicy, SimulationCommand, SimulationScenario, SimulationState } from "./types";

export const DEFAULT_ADAPTIVE_BACKOFF: BackoffConfig = { baseDelayTicks: 1, maxDelayTicks: 8, jitterTicks: 2, seed: 1337 };

export interface RecoveryExperiment {
  readonly scenario: SimulationScenario;
  readonly durationTicks: number;
  readonly retry: Omit<RetryConfig, "policy" | "backoff" | "circuitBreaker">;
  readonly adaptive?: { readonly backoff?: BackoffConfig; readonly circuitBreaker?: CircuitBreakerConfig };
  readonly schedule: readonly { readonly tick: number; readonly command: SimulationCommand }[];
}

export interface RecoveryMetrics {
  readonly totalUniqueRequests: number;
  readonly completedUniqueRequests: number;
  readonly retryAttempts: number;
  readonly abandonedRequests: number;
  readonly pendingRequests: number;
  readonly peakGatewayUtilizationPercent: number;
  readonly overloadFailures: number;
  readonly secondaryFailures: number;
  readonly unavailableTicks: number;
  readonly stableRecoveryTick: number | null;
}

export interface RecoveryRun {
  readonly policy: RetryPolicy;
  readonly initialState: SimulationState;
  readonly finalState: SimulationState;
  readonly metrics: RecoveryMetrics;
  readonly resilience: ResilienceMetrics;
}

export interface ResilienceMetrics {
  readonly peakRetryTrafficPerTick: number;
  readonly breakerTrips: number;
  readonly breakerOpenTicks: number;
  readonly deferredAttempts: number;
  readonly successfulHalfOpenProbes: number;
  readonly retryAbandonmentCount: number;
}

export interface RecoveryComparison {
  readonly durationTicks: number;
  readonly naive: RecoveryRun;
  readonly controlled: RecoveryRun;
  readonly adaptive: RecoveryRun;
}

/** Every scheduled command is applied as written; invalid schedules fail visibly. */
export function runRecoveryExperiment(experiment: RecoveryExperiment, policy: RetryPolicy): RecoveryRun {
  if (!Number.isSafeInteger(experiment.durationTicks) || experiment.durationTicks <= 0
    || experiment.durationTicks > experiment.scenario.config.maxTicks) throw new Error("Invalid experiment duration.");
  if (!experiment.scenario.routingPool) throw new Error("A recovery experiment requires a gateway pool.");
  const commands = new Map<number, SimulationCommand>();
  for (const item of experiment.schedule) {
    if (!Number.isSafeInteger(item.tick) || item.tick < 1 || item.tick > experiment.durationTicks) throw new Error("Scheduled tick is outside the experiment horizon.");
    if (commands.has(item.tick)) throw new Error("Only one command is allowed per scheduled tick.");
    commands.set(item.tick, item.command);
  }
  const adaptive = policy === "adaptive" ? experiment.adaptive ?? { backoff: DEFAULT_ADAPTIVE_BACKOFF } : {};
  const scenario = { ...experiment.scenario, retry: { ...experiment.retry, policy, ...adaptive } };
  const initialState = initializeSimulation(scenario);
  let state = initialState;
  let peakGatewayUtilizationPercent = 0;
  let overloadFailures = 0;
  let secondaryFailures = 0;
  let unavailableTicks = 0;
  let peakRetryTrafficPerTick = 0;
  let retryAbandonmentCount = 0;
  for (let tick = 1; tick <= experiment.durationTicks; tick += 1) {
    const previous = state;
    state = step(scenario, previous, commands.get(tick));
    peakGatewayUtilizationPercent = Math.max(peakGatewayUtilizationPercent, state.retry!.attemptUtilizationPercent);
    peakRetryTrafficPerTick = Math.max(peakRetryTrafficPerTick, state.retry!.retryAttemptsPerTick);
    if (state.routingPool!.availableCapacityPerTick === 0) unavailableTicks += 1;
    for (const event of state.events.slice(previous.events.length)) {
      if (event.type === "retry-requests-abandoned") retryAbandonmentCount += event.expired + event.overflow + (event.attemptLimit ?? 0);
      if (event.type === "overload-failed" && scenario.routingPool!.memberIds.includes(event.serviceId)) {
        overloadFailures += 1;
        if (event.afterRepair) secondaryFailures += 1;
      }
    }
  }
  const retry = state.retry!;
  return { policy, initialState, finalState: state, resilience: {
    peakRetryTrafficPerTick, retryAbandonmentCount,
    breakerTrips: state.circuitBreaker?.trips ?? 0,
    breakerOpenTicks: state.circuitBreaker?.openTicks ?? 0,
    deferredAttempts: state.circuitBreaker?.deferredAttempts ?? 0,
    successfulHalfOpenProbes: state.circuitBreaker?.successfulProbes ?? 0,
  }, metrics: {
    totalUniqueRequests: retry.totalUniqueRequests,
    completedUniqueRequests: retry.totalCompletedRequests,
    retryAttempts: retry.totalRetryAttempts,
    abandonedRequests: retry.totalAbandonedRequests,
    pendingRequests: retry.pendingRequests,
    peakGatewayUtilizationPercent, overloadFailures, secondaryFailures, unavailableTicks,
    stableRecoveryTick: retry.stableRecoveryTick,
  } };
}

/** Fresh independent runs; policy is the only scenario input that differs. */
export function compareRecoveryStrategies(experiment: RecoveryExperiment): RecoveryComparison {
  return { durationTicks: experiment.durationTicks,
    naive: runRecoveryExperiment(experiment, "naive"), controlled: runRecoveryExperiment(experiment, "controlled"),
    adaptive: runRecoveryExperiment(experiment, "adaptive") };
}
