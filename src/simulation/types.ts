export type ServiceId = string;
export type ServiceStatus = "healthy" | "degraded" | "offline" | "recovering";

export interface ServiceNode {
  readonly id: ServiceId;
  readonly name: string;
  readonly description: string;
  readonly capacityPerTick?: number;
}

// Direction: consumer -> provider ("depends on").
export interface Dependency {
  readonly consumerId: ServiceId;
  readonly providerId: ServiceId;
  readonly kind: "required" | "optional";
}

export type LocalCondition =
  | { readonly kind: "ready" }
  | { readonly kind: "failed"; readonly cause?: { readonly type: "overload"; readonly tick: number } }
  | { readonly kind: "recovering"; readonly readyAtTick: number };

export interface ServiceRuntime {
  readonly local: LocalCondition;
  readonly status: ServiceStatus;
  readonly traffic?: ServiceTraffic;
}

export interface ServiceTraffic {
  readonly offeredDemandPerTick: number;
  readonly incomingDemandPerTick: number;
  readonly availableCapacityPerTick: number;
  readonly utilizationPercent: number;
  readonly consecutiveOverloadedTicks: number;
}

export type WorkloadPresetId = "normal" | "high" | "spike";

export interface WorkloadPreset {
  readonly id: WorkloadPresetId;
  readonly name: string;
  readonly description: string;
  readonly demandPerTick: Readonly<Record<ServiceId, number>>;
}

export interface SimulationConfig {
  readonly tickDurationMs: number;
  readonly recoveryTicks: number;
  readonly maxTicks: number;
  readonly overloadFailureTicks?: number; // Defaults to 3 when traffic is enabled.
}

export interface RoutingPool {
  readonly id: string;
  readonly serviceId: ServiceId;
  readonly memberIds: readonly [ServiceId, ServiceId];
  readonly demandPerTick: number;
}

export type PoolStatus = "healthy" | "degraded" | "offline";

export interface PoolMemberTraffic {
  readonly assignedRequestsPerTick: number;
  readonly processedRequestsPerTick: number;
  readonly unservedRequestsPerTick: number;
}

export interface RoutingPoolState {
  readonly id: string;
  readonly status: PoolStatus;
  readonly incomingDemandPerTick: number;
  readonly assignedRequestsPerTick: number;
  readonly unassignedRequestsPerTick: number;
  readonly processedRequestsPerTick: number;
  readonly unservedRequestsPerTick: number;
  readonly availableCapacityPerTick: number;
  readonly routedMemberIds: readonly ServiceId[];
  readonly members: Readonly<Record<ServiceId, PoolMemberTraffic>>;
}

export interface SimulationMetrics {
  readonly incomingRequestsPerTick: number;
  readonly processedRequestsPerTick: number;
  readonly unservedRequestsPerTick: number;
  readonly overloadedServices: number;
  readonly offlineServices: number;
  readonly impactedDownstreamServices: number;
}

export type RetryPolicy = "naive" | "controlled" | "adaptive";

export interface BackoffConfig {
  readonly baseDelayTicks: number;
  readonly maxDelayTicks: number;
  readonly jitterTicks: number;
  readonly seed: number;
}

export interface CircuitBreakerConfig {
  readonly failureThreshold: number; // Consecutive observed ticks with failed admitted requests.
  readonly cooldownTicks: number;
  readonly halfOpenProbeBudget: number;
}

export type BreakerPhase = "closed" | "open" | "half_open";

export interface CircuitBreakerState {
  readonly state: BreakerPhase;
  readonly consecutiveFailureTicks: number;
  readonly nextProbeTick: number | null;
  readonly trips: number;
  readonly openTicks: number;
  readonly deferredAttempts: number;
  readonly successfulProbes: number;
}

export interface RetryConfig {
  readonly policy: RetryPolicy;
  readonly maxPendingRequests: number;
  readonly maxAgeTicks: number;
  readonly eligibilityPercent: number;
  readonly retryBudgetPerTick: number;
  readonly maxRetryAttempts?: number; // Unset legacy runs are bounded by request age.
  readonly backoff?: BackoffConfig;
  readonly circuitBreaker?: CircuitBreakerConfig;
}

export interface RetryCohort {
  readonly bornTick: number;
  readonly count: number;
  readonly attempts?: number; // Retry attempts already issued; original request is not a retry.
  readonly eligibleTick?: number;
  readonly bucket?: number; // Stable aggregate jitter bucket, not a per-request object.
}

export interface RetryState {
  readonly cohorts: readonly RetryCohort[];
  readonly pendingRequests: number;
  readonly newRequestsPerTick: number;
  readonly retryAttemptsPerTick: number;
  readonly completedNewRequestsPerTick: number;
  readonly completedRetryRequestsPerTick: number;
  readonly abandonedRequestsPerTick: number;
  readonly totalUniqueRequests: number;
  readonly totalCompletedRequests: number;
  readonly totalAbandonedRequests: number;
  readonly totalRetryAttempts: number;
  readonly attemptUtilizationPercent: number;
  readonly repairedMemberIds: readonly ServiceId[];
  readonly stableTicks: number;
  readonly stableRecoveryTick: number | null;
}

export type SimulationCommand = {
  readonly type: "fail" | "repair";
  readonly serviceId: ServiceId;
};

export type SimulationEvent = {
  readonly tick: number;
  readonly serviceId: ServiceId;
} & (
  | { readonly type: "command-applied"; readonly command: "fail" | "repair" }
  | {
      readonly type: "status-changed";
      readonly from: ServiceStatus;
      readonly to: ServiceStatus;
      readonly providerIds: readonly ServiceId[];
    }
  | {
      readonly type: "overload-started" | "overload-failed";
      readonly demandPerTick: number;
      readonly capacityPerTick: number;
      readonly utilizationPercent: number;
      readonly consecutiveOverloadedTicks: number;
      readonly afterRepair?: boolean;
    }
  | {
      readonly type: "traffic-redistributed";
      readonly poolId: string;
      readonly fromMemberIds: readonly ServiceId[];
      readonly toMemberIds: readonly ServiceId[];
      readonly assignments: Readonly<Record<ServiceId, number>>;
      readonly unassignedRequestsPerTick: number;
    }
  | {
      readonly type: "pool-status-changed";
      readonly poolId: string;
      readonly from: PoolStatus;
      readonly to: PoolStatus;
      readonly availableCapacityPerTick: number;
      readonly processedRequestsPerTick: number;
      readonly unservedRequestsPerTick: number;
    }
  | { readonly type: "recovery-completed" }
  | { readonly type: "retry-attempts-released"; readonly attempts: number; readonly policy: RetryPolicy; readonly admissionCapacityPerTick: number }
  | { readonly type: "retry-backlog-grew"; readonly pendingBefore: number; readonly pendingAfter: number }
  | { readonly type: "retry-requests-abandoned"; readonly expired: number; readonly ineligible: number; readonly overflow: number; readonly attemptLimit?: number }
  | { readonly type: "retry-backoff-scheduled"; readonly requests: number; readonly cohorts: number; readonly earliestTick: number; readonly latestTick: number }
  | { readonly type: "breaker-opened"; readonly reason: "threshold" | "failed-probe"; readonly nextProbeTick: number }
  | { readonly type: "breaker-half-opened"; readonly probeBudget: number }
  | { readonly type: "breaker-closed" }
  | { readonly type: "breaker-probe-result"; readonly processed: number; readonly failed: number }
  | { readonly type: "stable-recovery-achieved"; readonly consecutiveTicks: number }
);

export interface SimulationState {
  readonly tick: number;
  readonly services: Readonly<Record<ServiceId, ServiceRuntime>>;
  readonly events: readonly SimulationEvent[];
  readonly routingPool?: RoutingPoolState;
  readonly metrics?: SimulationMetrics;
  readonly retry?: RetryState;
  readonly circuitBreaker?: CircuitBreakerState;
}

export interface SimulationScenario {
  readonly id: string;
  readonly nodes: readonly ServiceNode[];
  readonly dependencies: readonly Dependency[];
  readonly config: SimulationConfig;
  readonly workload?: WorkloadPreset;
  readonly routingPool?: RoutingPool;
  readonly retry?: RetryConfig;
}
