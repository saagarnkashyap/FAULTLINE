import type {
  Dependency,
  LocalCondition,
  ServiceId,
  ServiceRuntime,
  ServiceTraffic,
  ServiceStatus,
  SimulationCommand,
  SimulationEvent,
  SimulationScenario,
  SimulationState,
} from "./types";
import { aggregatePool, calculateMetrics, routeTraffic } from "./routing";
import { finishRetries, initialRetryState, prepareRetries, validateRetryConfig } from "./retries";
import { finishCircuitBreaker, initialCircuitBreaker, prepareCircuitBreaker } from "./circuitBreaker";

/** Throws a readable error for an invalid typed scenario. Does not modify it. */
export function validateScenario(scenario: SimulationScenario): void {
  if (!scenario.id.trim()) throw new Error("Scenario ID must not be empty.");
  if (scenario.nodes.length === 0) throw new Error("Scenario must contain services.");

  for (const [name, value] of Object.entries(scenario.config)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Config ${name} must be a positive safe integer.`);
    }
  }
  if (!Number.isSafeInteger(scenario.config.maxTicks + scenario.config.recoveryTicks)) {
    throw new Error("Config tick limits exceed safe integer arithmetic.");
  }

  const ids = new Set<ServiceId>();
  const providers = new Map<ServiceId, ServiceId[]>();
  for (const node of scenario.nodes) {
    if (!node.id.trim()) throw new Error("Service ID must not be empty.");
    if (ids.has(node.id)) throw new Error(`Duplicate service ID: ${node.id}.`);
    if (node.capacityPerTick !== undefined && (!Number.isSafeInteger(node.capacityPerTick) || node.capacityPerTick <= 0)) {
      throw new Error(`Capacity for ${node.id} must be a positive safe integer.`);
    }
    ids.add(node.id);
    providers.set(node.id, []);
  }

  if (scenario.workload) {
    for (const node of scenario.nodes) {
      if (node.capacityPerTick === undefined) throw new Error(`Missing capacity for workload service: ${node.id}.`);
      const demand = scenario.workload.demandPerTick[node.id];
      if (!Object.hasOwn(scenario.workload.demandPerTick, node.id) || !Number.isSafeInteger(demand) || demand! < 0) {
        throw new Error(`Demand for ${node.id} must be a nonnegative safe integer.`);
      }
    }
    for (const id of Object.keys(scenario.workload.demandPerTick)) {
      if (!ids.has(id)) throw new Error(`Unknown workload service: ${id}.`);
    }
  }

  const pairs = new Set<string>();
  for (const dependency of scenario.dependencies) {
    const { consumerId, providerId, kind } = dependency;
    if (!ids.has(consumerId) || !ids.has(providerId)) {
      throw new Error(`Unknown dependency endpoint: ${consumerId} -> ${providerId}.`);
    }
    if (consumerId === providerId) throw new Error(`Self-dependency: ${consumerId}.`);
    if (kind !== "required" && kind !== "optional") {
      throw new Error(`Invalid dependency kind: ${String(kind)}.`);
    }
    const pair = JSON.stringify([consumerId, providerId]);
    if (pairs.has(pair)) throw new Error(`Duplicate dependency: ${consumerId} -> ${providerId}.`);
    pairs.add(pair);
    providers.get(consumerId)?.push(providerId);
  }

  const pool = scenario.routingPool;
  if (pool) {
    if (!pool.id.trim()) throw new Error("Routing pool ID must not be empty.");
    if (!scenario.workload) throw new Error("A routing pool requires a workload.");
    if (!ids.has(pool.serviceId)) throw new Error("Unknown logical pool service.");
    if (pool.memberIds.length !== 2 || new Set(pool.memberIds).size !== 2) {
      throw new Error("The routing pool requires exactly two distinct members.");
    }
    if (!Number.isSafeInteger(pool.demandPerTick) || pool.demandPerTick < 0) {
      throw new Error("Pool demand must be a nonnegative safe integer.");
    }
    for (const id of pool.memberIds) {
      if (!ids.has(id) || id === pool.serviceId) throw new Error("Invalid routing pool member.");
      if (providers.get(pool.serviceId)!.includes(id)) throw new Error("Pool membership must not be an ordinary dependency.");
      providers.get(pool.serviceId)!.push(id); // Also validate cycles through virtual pool membership.
    }
    for (const id of [pool.serviceId, ...pool.memberIds]) {
      if (scenario.workload.demandPerTick[id] !== 0) throw new Error("Pool participants must have zero independent demand.");
    }
    const memberCapacity = pool.memberIds.reduce((sum, id) => sum + scenario.nodes.find((node) => node.id === id)!.capacityPerTick!, 0);
    const totalDemand = Object.values(scenario.workload.demandPerTick).reduce((sum, demand) => sum + demand, pool.demandPerTick);
    if (!Number.isSafeInteger(memberCapacity) || !Number.isSafeInteger(totalDemand)) {
      throw new Error("Aggregate pool capacity and demand must stay within safe integer limits.");
    }
  }

  validateRetryConfig(scenario);
  const visiting = new Set<ServiceId>();
  const visited = new Set<ServiceId>();
  function visit(id: ServiceId): void {
    if (visiting.has(id)) throw new Error(`Dependency cycle involving: ${id}.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const provider of providers.get(id) ?? []) visit(provider);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
}

export function initializeSimulation(scenario: SimulationScenario): SimulationState {
  validateScenario(scenario);
  const initial: SimulationState = {
    tick: 0,
    services: Object.fromEntries(
      scenario.nodes.map(({ id }) => id).sort().map((id) => [
        id,
        {
          local: { kind: "ready" }, status: "healthy",
          ...(scenario.workload ? { traffic: {
            offeredDemandPerTick: scenario.routingPool?.serviceId === id
              ? scenario.routingPool.demandPerTick : scenario.workload.demandPerTick[id]!,
            incomingDemandPerTick: 0,
            availableCapacityPerTick: scenario.nodes.find((node) => node.id === id)!.capacityPerTick!,
            utilizationPercent: 0,
            consecutiveOverloadedTicks: 0,
          } } : {}),
        } satisfies ServiceRuntime,
      ]),
    ),
    events: [],
  };
  if (!scenario.routingPool) return initial;
  const pool = scenario.routingPool;
  const zeroDemandPool = { ...pool, demandPerTick: 0 };
  return { ...initial,
    routingPool: aggregatePool(zeroDemandPool, routeTraffic(zeroDemandPool, pool.memberIds), initial.services),
    metrics: { incomingRequestsPerTick: 0, processedRequestsPerTick: 0, unservedRequestsPerTick: 0,
      overloadedServices: 0, offlineServices: 0, impactedDownstreamServices: 0 },
    ...(scenario.retry ? { retry: initialRetryState() } : {}),
    ...(scenario.retry?.circuitBreaker ? { circuitBreaker: initialCircuitBreaker() } : {}) };
}

export function resetSimulation(scenario: SimulationScenario): SimulationState {
  return initializeSimulation(scenario);
}

function getService(state: SimulationState, id: ServiceId): ServiceRuntime {
  if (!Object.hasOwn(state.services, id)) {
    throw new Error(`Unknown service in simulation state: ${id}.`);
  }
  return state.services[id]!;
}

function validateCommand(
  scenario: SimulationScenario,
  previous: SimulationState,
  command: SimulationCommand,
): void {
  if (!scenario.nodes.some(({ id }) => id === command.serviceId)) {
    throw new Error(`Unknown command service: ${command.serviceId}.`);
  }
  const { local } = getService(previous, command.serviceId);
  if (command.type === "fail") {
    if (local.kind === "failed") throw new Error("Service is already locally failed.");
  } else if (command.type === "repair") {
    if (local.kind !== "failed") throw new Error("Only a locally failed service can be repaired.");
  } else {
    throw new Error("Unknown simulation command.");
  }
}

function recalculateServiceStatus(
  local: LocalCondition,
  dependencies: readonly Dependency[],
  previous: SimulationState,
): { status: ServiceStatus; providerIds: ServiceId[] } {
  if (local.kind === "failed") return { status: "offline", providerIds: [] };
  if (local.kind === "recovering") return { status: "recovering", providerIds: [] };

  const blocking: ServiceId[] = [];
  const degrading: ServiceId[] = [];
  for (const { providerId, kind } of dependencies) {
    const { status } = getService(previous, providerId);
    if (kind === "required" && (status === "offline" || status === "recovering")) {
      blocking.push(providerId);
    } else if (status !== "healthy") {
      degrading.push(providerId);
    }
  }
  if (blocking.length) return { status: "offline", providerIds: blocking.sort() };
  if (degrading.length) return { status: "degraded", providerIds: degrading.sort() };
  return { status: "healthy", providerIds: [] };
}

/** One synchronous tick; all dependency reads come from the previous snapshot. */
export function step(
  scenario: SimulationScenario,
  previous: SimulationState,
  command?: SimulationCommand,
): SimulationState {
  validateScenario(scenario);
  if (command) validateCommand(scenario, previous, command);
  if (previous.tick >= scenario.config.maxTicks) return previous;

  const tick = previous.tick + 1;
  const events: SimulationEvent[] = [];
  if (command) {
    events.push({ type: "command-applied", tick, serviceId: command.serviceId, command: command.type });
  }

  const ids = scenario.nodes.map(({ id }) => id).sort();
  const completedRecoveries = new Set<ServiceId>();
  const prepared: Record<ServiceId, { local: LocalCondition; status: ServiceStatus; providerIds: ServiceId[] }> = Object.fromEntries(ids.map((id) => {
    const oldService = getService(previous, id);
    let local = oldService.local;
    if (local.kind === "recovering" && local.readyAtTick <= tick) local = { kind: "ready" };
    if (command?.serviceId === id) {
      local = command.type === "fail"
        ? { kind: "failed" }
        : { kind: "recovering", readyAtTick: tick + scenario.config.recoveryTicks };
    }
    if (scenario.retry && scenario.routingPool!.memberIds.includes(id)
      && oldService.local.kind === "recovering" && local.kind === "ready") completedRecoveries.add(id);

    return [id, { local, ...recalculateServiceStatus(
      local,
      scenario.dependencies.filter(({ consumerId }) => consumerId === id),
      previous,
    ) }] as const;
  }));
  const pool = scenario.routingPool;
  const canUse = (id: ServiceId) => prepared[id]!.local.kind === "ready" && prepared[id]!.status !== "offline";
  const eligibleIds = pool && canUse(pool.serviceId) ? pool.memberIds.filter(canUse) : [];
  const admissionCapacity = eligibleIds.reduce((sum, id) => sum + scenario.nodes.find((node) => node.id === id)!.capacityPerTick!, 0);
  const breakerConfig = scenario.retry?.circuitBreaker;
  const breakerAdmission = breakerConfig && pool
    ? prepareCircuitBreaker(breakerConfig, previous.circuitBreaker!, tick, pool.demandPerTick) : undefined;
  if (breakerAdmission?.halfOpened) events.push({ type: "breaker-half-opened", tick,
    serviceId: pool!.serviceId, probeBudget: breakerConfig!.halfOpenProbeBudget });
  const retryPlan = scenario.retry && pool
    ? prepareRetries(scenario.retry, previous.retry!, tick, admissionCapacity, pool.demandPerTick, breakerAdmission) : undefined;
  const offeredPool = pool && retryPlan ? { ...pool, demandPerTick: retryPlan.admittedNewRequests + retryPlan.attempts } : pool;
  const allocation = offeredPool ? routeTraffic(offeredPool, eligibleIds) : undefined;
  const repairedMemberIds = scenario.retry ? [...new Set([...previous.retry!.repairedMemberIds,
    ...(command?.type === "repair" && pool!.memberIds.includes(command.serviceId) ? [command.serviceId] : [])])].sort() : [];
  const overloadEvents = new Map<ServiceId, SimulationEvent>();
  const entries = ids.map((id) => {
    const oldService = getService(previous, id);
    let { local, status, providerIds } = prepared[id]!;
    let traffic: ServiceTraffic | undefined;
    if (scenario.workload && id !== pool?.serviceId) {
      const capacity = scenario.nodes.find((node) => node.id === id)!.capacityPerTick!;
      const demand = pool?.memberIds.includes(id) ? allocation!.assignments[id]! : scenario.workload.demandPerTick[id]!;
      // A required dependency outage blocks admission; optional/degraded providers do not.
      const canProcess = local.kind === "ready" && status !== "offline";
      const overloaded = canProcess && demand > capacity;
      const count = overloaded ? (oldService.traffic?.consecutiveOverloadedTicks ?? 0) + 1 : 0;
      const utilization = canProcess ? Math.round((demand / capacity) * 10000) / 100 : 0;
      traffic = {
        offeredDemandPerTick: demand,
        incomingDemandPerTick: canProcess ? demand : 0,
        availableCapacityPerTick: canProcess ? capacity : 0,
        utilizationPercent: utilization,
        consecutiveOverloadedTicks: count,
      };
      let overloadType: "overload-started" | "overload-failed" | undefined;
      if (overloaded) {
        if (count >= (scenario.config.overloadFailureTicks ?? 3)) {
          local = { kind: "failed", cause: { type: "overload", tick } };
          status = "offline";
          providerIds = [];
          overloadType = "overload-failed";
        } else {
          status = "degraded";
          if (count === 1) overloadType = "overload-started";
        }
      }
      if (overloadType) {
        overloadEvents.set(id, { type: overloadType, tick, serviceId: id, demandPerTick: demand,
          capacityPerTick: capacity, utilizationPercent: utilization, consecutiveOverloadedTicks: count,
          ...(repairedMemberIds.includes(id) ? { afterRepair: true } : {}) });
      }
    }
    prepared[id]!.providerIds = providerIds;
    return [id, { local, status, ...(traffic ? { traffic } : {}) } satisfies ServiceRuntime] as const;
  });
  const services: Record<ServiceId, ServiceRuntime> = Object.fromEntries(entries);
  let poolState = offeredPool && allocation ? aggregatePool(offeredPool, allocation, services) : undefined;
  // Client admission must not hide physical capacity shortage under the new workload.
  if (breakerConfig && poolState && poolState.availableCapacityPerTick > 0 && poolState.availableCapacityPerTick < pool!.demandPerTick) {
    poolState = { ...poolState, status: "degraded" };
  }
  if (pool && poolState) {
    const logical = services[pool.serviceId]!;
    const ready = canUse(pool.serviceId);
    const status = !ready ? logical.status : poolState.status === "offline" ? "offline"
      : logical.status === "degraded" || poolState.status === "degraded" ? "degraded" : "healthy";
    services[pool.serviceId] = { ...logical, status, traffic: {
      offeredDemandPerTick: offeredPool!.demandPerTick,
      incomingDemandPerTick: ready ? offeredPool!.demandPerTick : 0,
      availableCapacityPerTick: poolState.availableCapacityPerTick,
      utilizationPercent: ready && poolState.availableCapacityPerTick > 0
        ? Math.round(offeredPool!.demandPerTick / poolState.availableCapacityPerTick * 10000) / 100 : 0,
      consecutiveOverloadedTicks: 0,
    } };
    const fromMemberIds = previous.routingPool!.routedMemberIds;
    if (fromMemberIds.length !== poolState.routedMemberIds.length
      || fromMemberIds.some((id, index) => id !== poolState.routedMemberIds[index])) {
      events.push({ type: "traffic-redistributed", tick, serviceId: pool.serviceId, poolId: pool.id,
        fromMemberIds, toMemberIds: poolState.routedMemberIds, assignments: allocation!.assignments,
        unassignedRequestsPerTick: poolState.unassignedRequestsPerTick });
    }
  }
  if (retryPlan && retryPlan.attempts > 0) events.push({ type: "retry-attempts-released", tick,
    serviceId: pool!.serviceId, attempts: retryPlan.attempts, policy: scenario.retry!.policy,
    admissionCapacityPerTick: admissionCapacity });
  for (const id of ids) {
    if (completedRecoveries.has(id)) events.push({ type: "recovery-completed", tick, serviceId: id });
    const overloadEvent = overloadEvents.get(id);
    if (overloadEvent) events.push(overloadEvent);
    const from = previous.services[id]!.status;
    const to = services[id]!.status;
    if (from !== to) events.push({ type: "status-changed", tick, serviceId: id, from, to, providerIds: prepared[id]!.providerIds });
  }
  if (pool && poolState && poolState.status !== previous.routingPool!.status) {
    events.push({ type: "pool-status-changed", tick, serviceId: pool.serviceId, poolId: pool.id,
      from: previous.routingPool!.status, to: poolState.status,
      availableCapacityPerTick: poolState.availableCapacityPerTick,
      processedRequestsPerTick: poolState.processedRequestsPerTick, unservedRequestsPerTick: poolState.unservedRequestsPerTick });
  }
  const breakerResult = breakerConfig && breakerAdmission && retryPlan && poolState
    ? finishCircuitBreaker(breakerConfig, breakerAdmission, poolState, retryPlan.deferredByBreaker, tick, pool!.serviceId) : undefined;
  if (breakerResult) events.push(...breakerResult.events);
  const retryResult = retryPlan && poolState
    ? finishRetries(scenario, previous.retry!, retryPlan, poolState, services, repairedMemberIds, tick,
      !breakerResult || breakerResult.state.state === "closed") : undefined;
  if (retryResult) events.push(...retryResult.events);
  return { tick, services, events: [...previous.events, ...events],
    ...(poolState ? { routingPool: poolState, metrics: calculateMetrics(scenario, services, poolState) } : {}),
    ...(retryResult ? { retry: retryResult.state } : {}),
    ...(breakerResult ? { circuitBreaker: breakerResult.state } : {}) };
}

export function failService(
  scenario: SimulationScenario,
  previous: SimulationState,
  serviceId: ServiceId,
): SimulationState {
  return step(scenario, previous, { type: "fail", serviceId });
}

export function repairService(
  scenario: SimulationScenario,
  previous: SimulationState,
  serviceId: ServiceId,
): SimulationState {
  return step(scenario, previous, { type: "repair", serviceId });
}
