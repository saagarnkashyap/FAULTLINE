import type { BackoffConfig, RetryCohort } from "./types";

/** FNV-1a over stable cohort identity; independent of queue iteration/order. */
export function deterministicJitter(seed: number, identity: string, windowTicks: number): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < identity.length; index += 1) {
    hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619) >>> 0;
  }
  return hash % (windowTicks + 1);
}

/** attempts=0 schedules retry #1; after its failure, attempts=1 schedules retry #2. */
export function retryDelay(config: BackoffConfig, attempts: number, identity: string): number {
  // At exponent >=53, any safe-integer maximum delay is already reached.
  const nominal = Math.min(config.maxDelayTicks, config.baseDelayTicks * 2 ** Math.min(attempts, 53));
  const jitter = deterministicJitter(config.seed, `${identity}|${attempts}`, config.jitterTicks);
  return nominal + Math.min(jitter, config.maxDelayTicks - nominal);
}

export function scheduleCohort(cohort: RetryCohort, tick: number, config: BackoffConfig | undefined, poolIdentity: string): RetryCohort {
  const attempts = cohort.attempts ?? 0;
  const bucket = cohort.bucket ?? 0;
  const delay = config ? retryDelay(config, attempts, `${poolIdentity}|${cohort.bornTick}|${bucket}`) : 1;
  return { ...cohort, attempts, bucket, eligibleTick: tick + delay };
}
