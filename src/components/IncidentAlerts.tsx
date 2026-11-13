import type { IncidentAlert } from "../incident/incidentState";
import type { SimulationEvent } from "../simulation/types";
import { incidentNoticeTone } from "./incidentPresentation";

/** At most three visual cards; one aggregate live announcement lives in the summary. */
export function IncidentAlerts({ alerts, events }: { alerts: readonly IncidentAlert[]; events?: readonly SimulationEvent[] }) {
  return <div className="incident-cards" aria-label="Recent engine-confirmed incident notices">
    {alerts.filter(({ level }) => level !== "injection").slice(-3).map((alert) => <article key={alert.id} className={`incident-card incident-card-${alert.level} notice-${incidentNoticeTone(alert, events)}`}>
      <span className="eyebrow">TICK {alert.tick} · {alert.level.toUpperCase()}</span>
      <h3>{alert.title}</h3><p>{alert.detail}</p>
    </article>)}
  </div>;
}
