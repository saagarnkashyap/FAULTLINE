import type { Dispatch } from "react";
import type { IncidentAction, IncidentState } from "../incident/incidentState";
import { INCIDENT_TICK_CAP } from "../incident/incidentState";
import type { SimulationScenario } from "../simulation/types";
import { IncidentSummary } from "./IncidentSummary";

export function IncidentPlayback({ state, scenario, dispatch }: { state: IncidentState; scenario: SimulationScenario; dispatch: Dispatch<IncidentAction> }) {
  const incident = state.incident;
  const canContinue = incident && incident.phase !== "ended" && state.app.simulation.tick < scenario.config.maxTicks
    && state.app.simulation.tick - incident.startedAtTick < INCIDENT_TICK_CAP;
  return <section className="panel incident-playback-panel" aria-labelledby="incident-zero-heading">
    <div className="incident-toolbar"><div><h2 id="incident-zero-heading">INCIDENT ZERO · Event-driven playback</h2><p>One real engine tick every 2 seconds · bounded observation</p></div>
      <div className="incident-playback-controls">
        <label><input type="checkbox" checked={state.automatic} onChange={(event) => dispatch({ type: "playback-mode", automatic: event.currentTarget.checked })} /> Play automatically after Fail</label>
        <button className="button button-secondary" type="button" disabled={!incident || incident.phase !== "running"} onClick={() => dispatch({ type: "pause" })}>Pause</button>
        <button className="button button-secondary" type="button" disabled={!canContinue || incident?.phase !== "paused"} onClick={() => dispatch({ type: "resume" })}>Resume</button>
        <button className="button button-secondary" type="button" disabled={!canContinue} onClick={() => dispatch({ type: "skip" })}>Skip to End</button>
      </div>
    </div>
    <div className="comparison-notes"><p>Manual Step, Fail/Repair, or controller changes pause playback before applying your action. Reset and workload changes cancel it. AUTOPILOT runs only if already enabled. Quiet means no further observed cascade, not necessarily recovery.</p></div>
    <IncidentSummary state={state} scenario={scenario} />
  </section>;
}
