import { currentImpact, INCIDENT_TICK_CAP, incidentOngoing } from "../incident/incidentState";
import type { IncidentState } from "../incident/incidentState";
import type { SimulationScenario } from "../simulation/types";
import { StatusBadge } from "./StatusBadge";
import { incidentNoticeTone } from "./incidentPresentation";

export function IncidentSummary({ state, scenario }: { state: IncidentState; scenario: SimulationScenario }) {
  const { incident, app } = state;
  if (!incident) return <p className="comparison-empty">Select a service and Fail service to begin. All impact is calculated by the local simulator.</p>;
  const simulation = app.simulation;
  const impact = currentImpact(simulation);
  const ongoing = incidentOngoing(simulation);
  const name = (id: string) => scenario.nodes.find((node) => node.id === id)?.name ?? id;
  const requiredIds = [...new Set(scenario.dependencies.filter(({ consumerId, kind }) => kind === "required" && incident.affectedIds.includes(consumerId)).map(({ providerId }) => providerId))].sort();
  const pool = simulation.routingPool;
  const nominalCapacity = scenario.routingPool?.memberIds.reduce((sum, id) => sum + (scenario.nodes.find((node) => node.id === id)?.capacityPerTick ?? 0), 0);
  const heading = incident.stopReason === "cap" ? "Playback paused — incident may be ongoing"
    : incident.stopReason === "max-ticks" ? "Playback stopped — simulation tick limit reached"
      : incident.stopReason === "error" ? "Playback stopped — action could not be applied"
        : incident.phase === "running" ? "Observing calculated propagation"
          : incident.phase === "paused" ? "Playback paused — manual controls available"
            : ongoing ? "Cascade settled — incident remains ongoing" : "All services healthy — no pending incident work";
  return <div className="incident-summary">
    <div className="incident-summary-heading"><div><p className="eyebrow">{incident.phase === "ended" ? "INCIDENT SUMMARY" : "CURRENT OBSERVATION"}</p><h3>{heading}</h3></div>
      <span className={`incident-severity ${incident.criticalActive ? "is-critical" : ""}`}>{incident.criticalActive ? "Critical" : "Below critical threshold"}</span></div>
    <p>Trigger: <strong>{name(incident.triggerId)}</strong> at tick {incident.startedAtTick}. Current tick {simulation.tick} · elapsed {simulation.tick - incident.startedAtTick} simulation ticks · automatic window at most {INCIDENT_TICK_CAP} additional ticks.</p>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Incident trigger {name(incident.triggerId)} confirmed at tick {incident.startedAtTick}. Tick {simulation.tick}. {impact.offlineIds.length} offline, {impact.degradedIds.length} degraded, {impact.recoveringIds.length} recovering. {heading}.</p>
    <dl className="incident-metrics">
      <div className="metric-offline"><dt>Actual offline</dt><dd>{impact.offlineIds.length}</dd></div>
      <div className="metric-degraded"><dt>Actual degraded</dt><dd>{impact.degradedIds.length}</dd></div>
      <div className="metric-recovering"><dt>Recovering</dt><dd>{impact.recoveringIds.length}</dd></div>
      <div><dt>Peak offline + degraded</dt><dd>{incident.peakAffected}</dd></div>
      {pool && <><div><dt>Gateway availability</dt><dd>{pool.status}</dd></div>
        <div><dt>Available gateway capacity</dt><dd>{pool.availableCapacityPerTick}{nominalCapacity !== undefined ? ` / ${nominalCapacity}` : ""} req/tick</dd></div>
        {nominalCapacity !== undefined && <div><dt>Unavailable gateway capacity</dt><dd>{Math.max(0, nominalCapacity - pool.availableCapacityPerTick)} req/tick</dd></div>}
        <div><dt>Gateway unserved attempts</dt><dd>{pool.unservedRequestsPerTick} /tick</dd></div></>}
    </dl>
    <p className="actual-impact"><strong>Actual impact now:</strong> {[...impact.offlineIds, ...impact.degradedIds].map(name).join(", ") || "None"}.</p>
    <p><strong>Observed after injection ({incident.affectedIds.length}):</strong> {incident.affectedIds.map(name).join(", ")}. Includes the trigger and observed nonhealthy transitions; timing alone does not prove causation.</p>
    <details className="exposure-details"><summary>Potential dependency exposure ({incident.exposureIds.length}) · not confirmed failure</summary>
      <p>{incident.exposureIds.map(name).join(", ") || "No reachable dependents"}. Includes optional dependencies and gateway pool capacity paths; redundant backends may prevent actual impact.</p></details>
    {requiredIds.length > 0 && <details><summary>Required dependency status</summary><ul className="incident-dependencies">{requiredIds.map((id) => <li key={id}>{name(id)} <StatusBadge status={simulation.services[id]!.status} /></li>)}</ul></details>}
    <p><strong>Incident ongoing:</strong> {ongoing ? "Yes — nonhealthy services or pending retry/breaker work remain." : "No — all services healthy, retry backlog empty, breaker closed when configured."} Playback never repairs by itself. Existing AUTOPILOT {app.autopilotEnabled ? "is enabled and runs on each Step." : "is disabled; enable it in its panel if desired."}</p>
    <p>Continue with Step simulation, select a locally failed service to Repair, or Reset. All services and metrics are fictional; no real incident telemetry is used.</p>
    <details open><summary>Incident timeline ({incident.alerts.length} retained notices)</summary><ol className="incident-timeline">{incident.alerts.map((alert) => <li key={alert.id} className={`notice-${incidentNoticeTone(alert, simulation.events)}`}>
      <span>Tick {alert.tick}</span><strong>{alert.title}</strong><p>{alert.detail}</p>
    </li>)}</ol></details>
  </div>;
}
