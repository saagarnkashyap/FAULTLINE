import type { SimulationScenario } from "../simulation/types";
import { WORKLOAD_PRESETS } from "./workloads";

/** Fictional topology. Arrows run from consumers to their providers. */
export const enterpriseScenario: SimulationScenario = {
  id: "fictional-enterprise",
  nodes: [
    { id: "identity", name: "Identity", capacityPerTick: 200, description: "Employee sign-in and service authorization." },
    { id: "gateway", name: "API Gateway", capacityPerTick: 240, description: "Shared authenticated entry point for business APIs." },
    { id: "email", name: "Email", capacityPerTick: 120, description: "Internal mail delivery and inbox access." },
    { id: "calendar", name: "Calendar", capacityPerTick: 100, description: "Meetings and scheduling with optional email invitations." },
    { id: "assistant", name: "AI Assistant", capacityPerTick: 80, description: "Fictional assistant using internal documents; no external AI API." },
    { id: "documents", name: "Document Storage", capacityPerTick: 200, description: "Authenticated document access." },
    { id: "crm", name: "CRM", capacityPerTick: 100, description: "Customer records exposed through the gateway." },
    { id: "support", name: "Support", capacityPerTick: 80, description: "Case management requiring customer records." },
    { id: "billing", name: "Billing", capacityPerTick: 100, description: "Independent billing branch with optional payment notifications." },
    { id: "notifications", name: "Notification Service", capacityPerTick: 120, description: "Independent delivery service for billing notifications." },
  ],
  dependencies: [
    { consumerId: "gateway", providerId: "identity", kind: "required" },
    { consumerId: "email", providerId: "identity", kind: "required" },
    { consumerId: "calendar", providerId: "gateway", kind: "required" },
    { consumerId: "calendar", providerId: "email", kind: "optional" },
    { consumerId: "documents", providerId: "identity", kind: "required" },
    { consumerId: "assistant", providerId: "gateway", kind: "required" },
    { consumerId: "assistant", providerId: "documents", kind: "required" },
    { consumerId: "crm", providerId: "gateway", kind: "required" },
    { consumerId: "support", providerId: "crm", kind: "required" },
    { consumerId: "support", providerId: "email", kind: "optional" },
    { consumerId: "billing", providerId: "notifications", kind: "optional" },
  ],
  config: { tickDurationMs: 1000, recoveryTicks: 2, maxTicks: 1000 },
  workload: WORKLOAD_PRESETS.normal,
};
