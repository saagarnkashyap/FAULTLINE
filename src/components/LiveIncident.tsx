import type { Dispatch } from "react";
import type { IncidentAction, IncidentState } from "../incident/incidentState";
import { currentImpact, incidentOngoing, INCIDENT_TICK_CAP } from "../incident/incidentState";
import type { SimulationScenario } from "../simulation/types";
import { formatTime } from "./productCopy";

export function LiveIncident({ state, scenario, dispatch }: { state: IncidentState; scenario: SimulationScenario; dispatch: Dispatch<IncidentAction> }) {
  const incident = state.incident;
  const simulation = state.app.simulation;
  const impact = currentImpact(simulation);
  const canResume = incident?.phase === "paused" && simulation.tick - incident.startedAtTick < INCIDENT_TICK_CAP && simulation.tick < scenario.config.maxTicks;
  const name = (id: string) => scenario.nodes.find((node) => node.id === id)?.name ?? id;
  const nominal = scenario.routingPool?.memberIds.reduce((sum, id) => sum + (scenario.nodes.find((node) => node.id === id)?.capacityPerTick ?? 0), 0);
  const heading = !incident ? "Ready when you are" : incident.phase === "running" ? "Cascade in progress"
    : incident.stopReason === "cap" ? "Playback paused · incident may be ongoing"
      : incidentOngoing(simulation) ? "Incident ongoing" : "All services restored";
  return <section className="panel live-incident" aria-labelledby="live-incident-heading">
    <div className="incident-toolbar"><div><span className="eyebrow">INCIDENT ZERO</span><h2 id="live-incident-heading">{heading}</h2></div>
      <div className="incident-playback-controls">
        <label><input type="checkbox" checked={state.automatic} onChange={(event) => dispatch({ type: "playback-mode", automatic: event.currentTarget.checked })} /> Auto play</label>
        <button className="button button-secondary" type="button" disabled={incident?.phase !== "running"} onClick={() => dispatch({ type: "pause" })}>Pause</button>
        <button className="button button-secondary" type="button" disabled={!canResume} onClick={() => dispatch({ type: "resume" })}>Resume</button>
        <button className="button button-secondary" type="button" disabled={!incident || incident.phase === "ended"} onClick={() => dispatch({ type: "skip" })}>Skip to End</button>
      </div>
    </div>
    {!incident ? <p className="comparison-empty">Select a service. Fail it. Follow the impact.</p> : <div className="live-incident-body">
      <p className="live-trigger">Started with <strong>{name(incident.triggerId)}</strong> at {formatTime(incident.startedAtTick, scenario.config.tickDurationMs)}.</p>
      <div className="live-metrics">
        <div><span>Affected now</span><strong>{impact.affectedCount}</strong></div>
        <div><span>Peak impact</span><strong>{incident.peakAffected}</strong></div>
        {simulation.routingPool && <><div><span>Gateway capacity</span><strong>{simulation.routingPool.availableCapacityPerTick}<small> / {nominal}</small></strong></div>
          <div><span>Unserved requests</span><strong>{simulation.routingPool.unservedRequestsPerTick}<small> / step</small></strong></div></>}
      </div>
      <p className="live-affected">{[...impact.offlineIds, ...impact.degradedIds].map(name).join(" · ") || "No services currently affected"}</p>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{heading}. Time {formatTime(simulation.tick, scenario.config.tickDurationMs)}. {impact.offlineIds.length} offline. {impact.degradedIds.length} degraded. {impact.recoveringIds.length} recovering.</p>
    </div>}
  </section>;
}
