import { routeTraffic } from "./routing";
import { scheduleCohort } from "./retryScheduling";
import type { BreakerAdmission } from "./circuitBreaker";
import type {
  RetryCohort, RetryConfig, RetryState, RoutingPoolState, ServiceRuntime, SimulationEvent, SimulationScenario,
} from "./types";

export function initialRetryState(): RetryState {
  return { cohorts: [], pendingRequests: 0, newRequestsPerTick: 0, retryAttemptsPerTick: 0,
    completedNewRequestsPerTick: 0, completedRetryRequestsPerTick: 0, abandonedRequestsPerTick: 0,
    totalUniqueRequests: 0, totalCompletedRequests: 0, totalAbandonedRequests: 0, totalRetryAttempts: 0,
    attemptUtilizationPercent: 0, repairedMemberIds: [], stableTicks: 0, stableRecoveryTick: null };
}

export function validateRetryConfig(scenario: SimulationScenario): void {
  const config = scenario.retry;
  if (!config) return;
  if (!scenario.routingPool) throw new Error("Retries require a routing pool.");
  if (!["naive", "controlled", "adaptive"].includes(config.policy)) throw new Error("Unknown retry policy.");
  for (const name of ["maxPendingRequests", "maxAgeTicks", "eligibilityPercent", "retryBudgetPerTick"] as const) {
    const value = config[name];
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Retry ${name} must be a nonnegative safe integer.`);
  }
  if (config.maxAgeTicks <= 0) throw new Error("Retry maxAgeTicks must be positive.");
  if (config.eligibilityPercent > 100) throw new Error("Retry eligibilityPercent must not exceed 100.");
  if (config.maxRetryAttempts !== undefined && (!Number.isSafeInteger(config.maxRetryAttempts) || config.maxRetryAttempts < 0)) {
    throw new Error("Retry maxRetryAttempts must be a nonnegative safe integer.");
  }
  if (config.backoff) {
    const backoff = config.backoff;
    for (const key of ["baseDelayTicks", "maxDelayTicks", "jitterTicks", "seed"] as const) {
      if (!Number.isSafeInteger(backoff[key]) || backoff[key] < 0) throw new Error(`Retry backoff ${key} must be a nonnegative safe integer.`);
    }
    if (backoff.baseDelayTicks < 1 || backoff.maxDelayTicks < backoff.baseDelayTicks
      || backoff.jitterTicks > backoff.maxDelayTicks || backoff.seed > 0xffffffff
      || !Number.isSafeInteger(scenario.config.maxTicks + backoff.maxDelayTicks)) throw new Error("Invalid retry backoff bounds or seed.");
  }
  if (config.circuitBreaker) {
    const breaker = config.circuitBreaker;
    for (const key of ["failureThreshold", "cooldownTicks", "halfOpenProbeBudget"] as const) {
      if (!Number.isSafeInteger(breaker[key]) || breaker[key] < 1) throw new Error(`Circuit breaker ${key} must be a positive safe integer.`);
    }
    if (!Number.isSafeInteger(scenario.config.maxTicks + breaker.cooldownTicks + 1)) throw new Error("Circuit breaker cooldown exceeds safe tick limits.");
  }
  const totalExternal = Object.values(scenario.workload!.demandPerTick).reduce((sum, demand) => sum + demand, scenario.routingPool.demandPerTick);
  if (!Number.isSafeInteger((totalExternal + config.maxPendingRequests) * scenario.config.maxTicks)) {
    throw new Error("Retry experiment totals exceed safe integer accounting limits.");
  }
}

function count(cohorts: readonly RetryCohort[]): number {
  return cohorts.reduce((sum, cohort) => sum + cohort.count, 0);
}

/** Split FIFO cohorts without changing their original arrival tick. */
function takeOldest(cohorts: readonly RetryCohort[], amount: number) {
  let remainingBudget = amount;
  const taken: RetryCohort[] = [];
  const remaining: RetryCohort[] = [];
  for (const cohort of cohorts) {
    const issued = Math.min(remainingBudget, cohort.count);
    if (issued) taken.push({ ...cohort, count: issued });
    if (issued < cohort.count) remaining.push({ ...cohort, count: cohort.count - issued });
    remainingBudget -= issued;
  }
  return { taken, remaining };
}

interface RetryPlan {
  readonly issued: readonly RetryCohort[];
  readonly held: readonly RetryCohort[];
  readonly attempts: number;
  readonly expired: number;
  readonly admissionCapacity: number;
  readonly admittedNewRequests: number;
  readonly deferredByBreaker: number;
}

export function prepareRetries(config: RetryConfig, previous: RetryState, tick: number, capacity: number, newDemand: number, admission?: BreakerAdmission): RetryPlan {
  const alive = previous.cohorts.filter((cohort) => tick - cohort.bornTick < config.maxAgeTicks);
  const expired = previous.pendingRequests - count(alive);
  const due = alive.filter((cohort) => (cohort.eligibleTick ?? 0) <= tick);
  const future = alive.filter((cohort) => (cohort.eligibleTick ?? 0) > tick);
  const pending = count(due);
  const admittedNewRequests = admission?.newRequests ?? newDemand;
  const attempts = capacity === 0 ? 0 : config.policy === "naive" ? pending
    : Math.min(pending, config.retryBudgetPerTick, Math.max(0, capacity - admittedNewRequests));
  const permittedAttempts = Math.min(attempts, admission?.retrySlots ?? Infinity);
  const { taken, remaining } = takeOldest(due, permittedAttempts);
  const tracked = config.maxRetryAttempts !== undefined || config.backoff !== undefined;
  const issued = tracked ? taken.map((cohort) => ({ ...cohort, attempts: (cohort.attempts ?? 0) + 1 })) : taken;
  const deferredByBreaker = admission && admission.phase !== "closed"
    ? newDemand - admittedNewRequests + Math.max(0, pending - admission.retrySlots) : 0;
  return { issued, held: [...future, ...remaining], attempts: permittedAttempts, expired,
    admissionCapacity: capacity, admittedNewRequests, deferredByBreaker };
}

function cohortKey(cohort: RetryCohort): string {
  return `${cohort.bornTick}:${cohort.bucket ?? 0}:${cohort.attempts ?? 0}:${cohort.eligibleTick ?? 0}`;
}

/** Preserve age, attempt, and due-time distinctions; never merge unlike retries. */
function boundedQueue(cohorts: readonly RetryCohort[], limit: number) {
  const groups = new Map<string, RetryCohort>();
  for (const cohort of cohorts) {
    const key = cohortKey(cohort);
    groups.set(key, { ...cohort, count: (groups.get(key)?.count ?? 0) + cohort.count });
  }
  const merged = [...groups.values()].sort((a, b) => a.bornTick - b.bornTick
    || (a.bucket ?? 0) - (b.bucket ?? 0) || (a.attempts ?? 0) - (b.attempts ?? 0)
    || (a.eligibleTick ?? 0) - (b.eligibleTick ?? 0));
  const { taken, remaining } = takeOldest(merged, limit);
  return { cohorts: taken, overflow: count(remaining) };
}

/** Apply eligibility once to newly unserved unique requests, using exact integer arithmetic. */
function eligibleCount(requests: number, percent: number): number {
  return Math.floor(requests / 100) * percent + Math.floor((requests % 100) * percent / 100);
}

export function finishRetries(
  scenario: SimulationScenario,
  previous: RetryState,
  plan: RetryPlan,
  poolState: RoutingPoolState,
  services: Readonly<Record<string, ServiceRuntime>>,
  repairedMemberIds: readonly string[],
  tick: number,
  breakerClosed = true,
): { state: RetryState; events: SimulationEvent[] } {
  const pool = scenario.routingPool!;
  const config = scenario.retry!;
  // New requests take processing priority on each backend. Retry assignments are
  // the residual of the actual combined allocation, not a second routing pass.
  const freshShares = routeTraffic({ ...pool, demandPerTick: plan.admittedNewRequests }, poolState.routedMemberIds).assignments;
  let completedNew = 0;
  let completedRetries = 0;
  for (const id of pool.memberIds) {
    const member = poolState.members[id]!;
    const newProcessed = Math.min(freshShares[id]!, member.processedRequestsPerTick);
    completedNew += newProcessed;
    completedRetries += member.processedRequestsPerTick - newProcessed;
  }
  const newUnserved = pool.demandPerTick - completedNew;
  const newlyEligible = eligibleCount(newUnserved, config.eligibilityPercent);
  const ineligible = newUnserved - newlyEligible;
  // Successful retries leave the system permanently; failed retries keep their age.
  const failedRetries = takeOldest(plan.issued, completedRetries).remaining;
  const tracked = config.maxRetryAttempts !== undefined || config.backoff !== undefined;
  const maximumAttempts = config.maxRetryAttempts ?? config.maxAgeTicks;
  let attemptLimit = 0;
  const scheduled: RetryCohort[] = [];
  const retainedFailures: RetryCohort[] = [];
  const identity = `${scenario.id}|${pool.id}`;
  for (const cohort of failedRetries) {
    if ((cohort.attempts ?? 0) >= maximumAttempts) attemptLimit += cohort.count;
    else {
      const next = tracked ? scheduleCohort(cohort, tick, config.backoff, identity) : cohort;
      retainedFailures.push(next);
      if (config.backoff) scheduled.push(next);
    }
  }
  const fresh: RetryCohort[] = [];
  if (maximumAttempts === 0) attemptLimit += newlyEligible;
  else if (tracked) {
    const buckets = config.backoff && config.backoff.jitterTicks > 0 ? 4 : 1;
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      const requests = Math.floor(newlyEligible / buckets) + (bucket < newlyEligible % buckets ? 1 : 0);
      if (!requests) continue;
      const next = scheduleCohort({ bornTick: tick, count: requests, attempts: 0, bucket }, tick, config.backoff, identity);
      fresh.push(next);
      if (config.backoff) scheduled.push(next);
    }
  } else if (newlyEligible) fresh.push({ bornTick: tick, count: newlyEligible });
  const queued = boundedQueue([...plan.held, ...retainedFailures, ...fresh], config.maxPendingRequests);
  const pendingRequests = count(queued.cohorts);
  const abandoned = plan.expired + ineligible + queued.overflow + attemptLimit;
  const stable = breakerClosed && services[pool.serviceId]!.status === "healthy" && pendingRequests === 0
    && pool.memberIds.every((id) => services[id]!.local.kind === "ready" && services[id]!.status === "healthy");
  const stableTicks = stable ? previous.stableTicks + 1 : 0;
  const state: RetryState = {
    cohorts: queued.cohorts, pendingRequests, newRequestsPerTick: pool.demandPerTick,
    retryAttemptsPerTick: plan.attempts,
    completedNewRequestsPerTick: completedNew, completedRetryRequestsPerTick: completedRetries,
    abandonedRequestsPerTick: abandoned,
    totalUniqueRequests: previous.totalUniqueRequests + pool.demandPerTick,
    totalCompletedRequests: previous.totalCompletedRequests + completedNew + completedRetries,
    totalAbandonedRequests: previous.totalAbandonedRequests + abandoned,
    totalRetryAttempts: previous.totalRetryAttempts + plan.attempts,
    attemptUtilizationPercent: plan.admissionCapacity > 0
      ? Math.round((plan.admittedNewRequests + plan.attempts) / plan.admissionCapacity * 10000) / 100 : 0,
    repairedMemberIds,
    stableTicks,
    stableRecoveryTick: stableTicks < 3 ? null : previous.stableRecoveryTick ?? tick,
  };
  const events: SimulationEvent[] = [];
  const base = { tick, serviceId: pool.serviceId };
  if (scheduled.length) {
    const scheduledKeys = new Set(scheduled.map(cohortKey));
    const accepted = queued.cohorts.filter((cohort) => scheduledKeys.has(cohortKey(cohort)));
    if (accepted.length) events.push({ ...base, type: "retry-backoff-scheduled", requests: count(accepted), cohorts: accepted.length,
      earliestTick: Math.min(...accepted.map((cohort) => cohort.eligibleTick!)), latestTick: Math.max(...accepted.map((cohort) => cohort.eligibleTick!)) });
  }
  if (pendingRequests > previous.pendingRequests) events.push({ ...base, type: "retry-backlog-grew", pendingBefore: previous.pendingRequests, pendingAfter: pendingRequests });
  if (abandoned) events.push({ ...base, type: "retry-requests-abandoned", expired: plan.expired, ineligible, overflow: queued.overflow,
    ...(attemptLimit ? { attemptLimit } : {}) });
  if (stableTicks === 3) events.push({ ...base, type: "stable-recovery-achieved", consecutiveTicks: 3 });
  return { state, events };
}
