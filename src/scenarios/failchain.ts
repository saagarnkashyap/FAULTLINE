import type { SimulationScenario } from "../simulation/types";
import { enterpriseScenario } from "./enterprise";
import { withWorkload } from "./workloads";

/** Phase 2B extends the Phase 2A enterprise, retained as a regression scenario. */
const base: SimulationScenario = {
  ...enterpriseScenario,
  id: "failchain-gateway",
  nodes: [
    ...enterpriseScenario.nodes.map((node) => node.id === "gateway" ? { ...node, capacityPerTick: 180 } : node),
    { id: "gateway-a", name: "Gateway Instance A", capacityPerTick: 90, description: "First backend in the shared gateway pool." },
    { id: "gateway-b", name: "Gateway Instance B", capacityPerTick: 90, description: "Second backend in the shared gateway pool." },
  ],
  dependencies: [
    ...enterpriseScenario.dependencies,
    { consumerId: "gateway-a", providerId: "identity", kind: "required" },
    { consumerId: "gateway-b", providerId: "identity", kind: "required" },
  ],
  routingPool: { id: "gateway-backends", serviceId: "gateway", memberIds: ["gateway-a", "gateway-b"], demandPerTick: 120 },
};

export const failchainScenario = withWorkload(base, "normal");
