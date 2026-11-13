import type { SimulationScenario, WorkloadPreset, WorkloadPresetId } from "../simulation/types";

/** Fixed external demand, in requests/tick. Dependency links do not route traffic. */
export const WORKLOAD_PRESETS: Readonly<Record<WorkloadPresetId, WorkloadPreset>> = {
  normal: {
    id: "normal", name: "Normal", description: "All offered demand stays within service capacity.",
    demandPerTick: {
      identity: 100, gateway: 160, email: 70, calendar: 50, assistant: 40,
      documents: 120, crm: 60, support: 35, billing: 40, notifications: 60,
    },
  },
  high: {
    id: "high", name: "High", description: "Gateway exceeds capacity; several other services approach their limits.",
    demandPerTick: {
      identity: 180, gateway: 250, email: 110, calendar: 90, assistant: 76,
      documents: 180, crm: 90, support: 72, billing: 40, notifications: 60,
    },
  },
  spike: {
    id: "spike", name: "Spike", description: "Gateway, Email, and AI Assistant receive sustained 150% demand.",
    demandPerTick: {
      identity: 160, gateway: 360, email: 180, calendar: 90, assistant: 120,
      documents: 160, crm: 90, support: 65, billing: 40, notifications: 60,
    },
  },
};

/** Preserve topology identity; the application must initialize a fresh run on change. */
export function withWorkload(scenario: SimulationScenario, id: WorkloadPresetId): SimulationScenario {
  if (!Object.hasOwn(WORKLOAD_PRESETS, id)) throw new Error("Unknown workload preset.");
  const workload = WORKLOAD_PRESETS[id];
  if (scenario.routingPool) {
    const poolDemand = { normal: 120, high: 180, spike: 270 };
    const participants = [scenario.routingPool.serviceId, ...scenario.routingPool.memberIds];
    return { ...scenario,
      routingPool: { ...scenario.routingPool, demandPerTick: poolDemand[id] },
      workload: { ...workload,
        description: `Gateway pool receives ${poolDemand[id]} requests/tick; other services retain the ${workload.name} workload.`,
        demandPerTick: { ...workload.demandPerTick,
        ...Object.fromEntries(participants.map((serviceId) => [serviceId, 0])) } },
    };
  }
  return scenario.workload === workload ? scenario : { ...scenario, workload };
}
