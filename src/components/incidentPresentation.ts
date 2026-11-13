import type { IncidentAlert } from "../incident/incidentState";
import type { SimulationEvent } from "../simulation/types";

/** Historical notice color comes from the actual transition, never a guessed recovery. */
export function incidentNoticeTone(alert: IncidentAlert, events: readonly SimulationEvent[] = []): string {
  if (alert.level === "injection" || alert.level === "critical") return "offline";
  const transition = events.find((event) => event.type === "status-changed" && event.tick === alert.tick && event.serviceId === alert.serviceId);
  if (transition?.type === "status-changed") return transition.to;
  return alert.level === "recovery" ? "improved" : "degraded";
}
