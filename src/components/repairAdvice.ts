import type { SimulationScenario, SimulationState } from "../simulation/types";

/** Find an actually failed service in the affected service's provider/pool path. */
export function repairTarget(serviceId: string, scenario: SimulationScenario, state: SimulationState): string | null {
  const queue = [serviceId];
  const seen = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (state.services[id]?.local.kind === "failed") return id;
    const providers = scenario.dependencies.filter(({ consumerId }) => consumerId === id)
      .sort((a, b) => Number(a.kind === "optional") - Number(b.kind === "optional"));
    queue.push(...providers.map(({ providerId }) => providerId));
    if (scenario.routingPool && (id === scenario.routingPool.serviceId || scenario.routingPool.memberIds.includes(id))) {
      queue.push(...scenario.routingPool.memberIds.filter((memberId) => memberId !== id));
    }
  }
  return null;
}
