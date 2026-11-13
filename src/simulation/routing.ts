import type {
  RoutingPool, RoutingPoolState, ServiceId, ServiceRuntime, SimulationMetrics, SimulationScenario,
} from "./types";

interface Allocation {
  readonly routedMemberIds: readonly ServiceId[];
  readonly assignments: Readonly<Record<ServiceId, number>>;
  readonly unassignedRequestsPerTick: number;
}

/** Equal integer shares; any remainder goes to the first sorted eligible ID. */
export function routeTraffic(pool: RoutingPool, eligibleIds: readonly ServiceId[]): Allocation {
  const routedMemberIds = [...eligibleIds].sort();
  const count = routedMemberIds.length;
  const share = count ? Math.floor(pool.demandPerTick / count) : 0;
  const remainder = count ? pool.demandPerTick % count : 0;
  return {
    routedMemberIds,
    assignments: Object.fromEntries([...pool.memberIds].sort().map((id) => {
      const index = routedMemberIds.indexOf(id);
      return [id, index < 0 ? 0 : share + (index < remainder ? 1 : 0)] as const;
    })),
    unassignedRequestsPerTick: count ? 0 : pool.demandPerTick,
  };
}

/** Account after overload evaluation: newly failed instances process zero requests. */
export function aggregatePool(
  pool: RoutingPool,
  allocation: Allocation,
  services: Readonly<Record<ServiceId, ServiceRuntime>>,
): RoutingPoolState {
  let availableCapacityPerTick = 0;
  let processedRequestsPerTick = 0;
  const members = Object.fromEntries([...pool.memberIds].sort().map((id) => {
    const runtime = services[id]!;
    const assigned = allocation.assignments[id]!;
    const usable = allocation.routedMemberIds.includes(id) && runtime.local.kind === "ready"
      && runtime.status !== "offline" && runtime.status !== "recovering";
    const capacity = usable ? runtime.traffic!.availableCapacityPerTick : 0;
    const processed = Math.min(assigned, capacity);
    availableCapacityPerTick += capacity;
    processedRequestsPerTick += processed;
    return [id, { assignedRequestsPerTick: assigned, processedRequestsPerTick: processed,
      unservedRequestsPerTick: assigned - processed }] as const;
  }));
  const unservedRequestsPerTick = pool.demandPerTick - processedRequestsPerTick;
  return {
    id: pool.id,
    status: availableCapacityPerTick === 0 ? "offline" : unservedRequestsPerTick > 0 ? "degraded" : "healthy",
    incomingDemandPerTick: pool.demandPerTick,
    assignedRequestsPerTick: pool.demandPerTick - allocation.unassignedRequestsPerTick,
    unassignedRequestsPerTick: allocation.unassignedRequestsPerTick,
    processedRequestsPerTick,
    unservedRequestsPerTick,
    availableCapacityPerTick,
    routedMemberIds: allocation.routedMemberIds,
    members,
  };
}

/** Count each external source once: the pool plus independent non-pool services. */
export function calculateMetrics(
  scenario: SimulationScenario,
  services: Readonly<Record<ServiceId, ServiceRuntime>>,
  pool: RoutingPoolState,
): SimulationMetrics {
  const config = scenario.routingPool!;
  const aliases = new Set([config.serviceId, ...config.memberIds]);
  let incomingRequestsPerTick = pool.incomingDemandPerTick;
  let processedRequestsPerTick = pool.processedRequestsPerTick;
  let overloadedServices = 0;
  let offlineServices = 0;
  for (const { id } of scenario.nodes) {
    const runtime = services[id]!;
    const traffic = runtime.traffic;
    if (runtime.status === "offline") offlineServices += 1;
    if (id !== config.serviceId && (traffic?.consecutiveOverloadedTicks ?? 0) > 0) overloadedServices += 1;
    if (aliases.has(id) || !traffic) continue;
    incomingRequestsPerTick += traffic.offeredDemandPerTick;
    if (runtime.local.kind === "ready" && runtime.status !== "offline" && runtime.status !== "recovering") {
      processedRequestsPerTick += Math.min(traffic.incomingDemandPerTick, traffic.availableCapacityPerTick);
    }
  }
  // Reachability identifies downstream services; this count is not causal attribution.
  const downstream = new Set<ServiceId>();
  const pending = [config.serviceId];
  while (pending.length) {
    const providerId = pending.pop()!;
    for (const link of scenario.dependencies) {
      if (link.providerId === providerId && !downstream.has(link.consumerId)) {
        downstream.add(link.consumerId);
        pending.push(link.consumerId);
      }
    }
  }
  return { incomingRequestsPerTick, processedRequestsPerTick,
    unservedRequestsPerTick: incomingRequestsPerTick - processedRequestsPerTick,
    overloadedServices, offlineServices,
    impactedDownstreamServices: [...downstream].filter((id) => services[id]!.status !== "healthy").length };
}
