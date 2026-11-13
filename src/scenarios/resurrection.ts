import type { RecoveryExperiment } from "../simulation/experiments";
import { DEFAULT_ADAPTIVE_BACKOFF } from "../simulation/experiments";
import { failchainScenario } from "./failchain";

export const RECOVERY_EXPERIMENT: RecoveryExperiment = {
  scenario: failchainScenario,
  durationTicks: 40,
  retry: { maxPendingRequests: 2400, maxAgeTicks: 40, eligibilityPercent: 100, retryBudgetPerTick: 30 },
  schedule: [
    { tick: 2, command: { type: "fail", serviceId: "gateway-a" } },
    { tick: 6, command: { type: "repair", serviceId: "gateway-a" } },
    { tick: 7, command: { type: "repair", serviceId: "gateway-b" } },
  ],
};

export interface ResilienceSettings {
  readonly backoffEnabled: boolean;
  readonly baseDelayTicks: number;
  readonly maxDelayTicks: number;
  readonly jitterTicks: number;
  readonly seed: number;
  readonly maxRetryAttempts: number;
  readonly breakerEnabled: boolean;
}

export const DEFAULT_RESILIENCE_SETTINGS: ResilienceSettings = {
  backoffEnabled: true, ...DEFAULT_ADAPTIVE_BACKOFF, maxRetryAttempts: 6, breakerEnabled: true,
};

/** Queue limits and retry-attempt limits are shared by every compared strategy. */
export function createResilienceExperiment(settings: ResilienceSettings = DEFAULT_RESILIENCE_SETTINGS): RecoveryExperiment {
  return { ...RECOVERY_EXPERIMENT,
    retry: { ...RECOVERY_EXPERIMENT.retry, maxRetryAttempts: settings.maxRetryAttempts },
    adaptive: {
      ...(settings.backoffEnabled ? { backoff: { baseDelayTicks: settings.baseDelayTicks,
        maxDelayTicks: settings.maxDelayTicks, jitterTicks: settings.jitterTicks, seed: settings.seed } } : {}),
      ...(settings.breakerEnabled ? { circuitBreaker: { failureThreshold: 3, cooldownTicks: 3, halfOpenProbeBudget: 10 } } : {}),
    },
  };
}
