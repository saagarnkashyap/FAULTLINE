import type { IncidentSession } from "../incident/incidentState";
import { IncidentAlerts } from "./IncidentAlerts";
import { useState } from "react";
import type { SimulationEvent } from "../simulation/types";

/** Nonblocking, graph-local notices. No visual effect can change simulation state. */
export function IncidentOverlay({ incident, events }: { incident: IncidentSession | null; events?: readonly SimulationEvent[] }) {
  const [dismissedIds, setDismissedIds] = useState<readonly string[]>([]);
  if (!incident) return null;
  const injection = incident.alerts.find(({ level }) => level === "injection");
  const visible = incident.alerts.filter(({ id }) => !dismissedIds.includes(id));
  return <div className={`incident-overlay ${incident.phase === "running" ? "is-playing" : ""}`}>
    {injection && <div key={`${incident.startedAtTick}:${incident.triggerId}`} className="incident-injection" aria-hidden="true">
      <span className="eyebrow">INCIDENT ZERO / FAULT CONFIRMED</span><strong>{injection.title}</strong>
    </div>}
    <div className="incident-indicator"><span className="incident-beacon" />{incident.criticalActive ? "CRITICAL CASCADE" : "INCIDENT ZERO"}
      <span> {incident.phase === "running" ? "LIVE PLAYBACK" : "OBSERVATION"}</span></div>
    <button className="notice-dismiss" type="button" disabled={!visible.some(({ level }) => level !== "injection")}
      onClick={() => setDismissedIds(incident.alerts.map(({ id }) => id))} aria-label="Dismiss visible notices" title="Hide current cards; all retained notices remain in the incident timeline">Dismiss notices</button>
    <IncidentAlerts key={incident.startedAtTick} alerts={visible} events={events} />
  </div>;
}
