import { useState } from "react";
import type { AppState } from "../appState";
import { AUTOPILOT_EXPERIMENT } from "../scenarios/autopilot";
import { decideAutopilot, nextRepairTick } from "../simulation/autopilot";
import type { AutopilotDecision } from "../simulation/autopilot";
import { compareAutopilot } from "../simulation/autopilotExperiments";
import type { AutopilotComparison, AutopilotMetrics } from "../simulation/autopilotExperiments";
import type { SimulationScenario } from "../simulation/types";

export function ControllerDecisions({ decisions }: { decisions: readonly AutopilotDecision[] }) {
  return <details><summary>Controller decisions ({decisions.length}) · separate from engine events</summary>
    {decisions.length ? <ol className="controller-decisions">{decisions.map((decision) => <li key={decision.tick}>
      Tick {decision.tick} · {decision.action.toUpperCase()} {decision.serviceId ?? ""} · {decision.rule}: {decision.reason}
    </li>)}</ol> : <p>No controller step recorded.</p>}
  </details>;
}

export function AutopilotStatus({ state, scenario, onToggle, onCooldown }: {
  state: AppState; scenario: SimulationScenario; onToggle: (enabled: boolean) => void; onCooldown: (ticks: number) => void;
}) {
  const last = state.controller.decisions.at(-1);
  const next = decideAutopilot(scenario, state.simulation, state.controller, state.autopilotConfig);
  const mode = !state.autopilotEnabled ? "Disabled" : next.action === "repair" ? "Repair selected"
    : next.rule === "no-local-failure" ? "Monitoring" : "Waiting";
  return <div className="comparison-notes">
    <div className="resilience-controls">
      <label><input type="checkbox" checked={state.autopilotEnabled} onChange={(event) => onToggle(event.currentTarget.checked)} /> Enable AUTOPILOT</label>
      <label>Recovery cooldown (complete ticks)<input type="number" min={0} max={1000} step={1} value={state.autopilotConfig.cooldownTicks}
        onChange={(event) => onCooldown(event.currentTarget.valueAsNumber)} /></label>
    </div>
    <div className="controller-overview">
      <div className="controller-state-card"><span className={`controller-chip ${state.autopilotEnabled ? "is-enabled" : ""}`}>{mode}</span>
        <p><strong>Controller state:</strong> {state.autopilotEnabled ? `Enabled · ${next.action.toUpperCase()} on next Step (${next.rule})` : "Disabled · manual simulation"}.</p>
        <p>{state.autopilotEnabled ? next.reason : "Enable to evaluate recovery rules on each explicit or playback Step."}</p></div>
      <div className="controller-state-card"><span className="card-label">LAST ENGINE-BOUND DECISION</span>
        <p><strong>Last selected action:</strong> {last ? `${last.action.toUpperCase()} ${last.serviceId ?? ""} at tick ${last.tick}. ${last.reason}` : "None; no controller step recorded."}</p></div>
    </div>
    <p>Step simulation explicitly evaluates one action. Manual Fail/Repair takes the entire tick and overrides the controller. Manual commands retain existing permissions; gateway repairs count against the controller budget, even while disabled.</p>
    <p>At most {state.autopilotConfig.maxRepairsPerInstance} repairs per instance and {state.autopilotConfig.maxInterventions} total controller interventions. Reset or a workload change disables AUTOPILOT and clears history. Toggling does not clear budgets.</p>
    <ul className="controller-instances">{Object.entries(state.controller.instances).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, history]) => {
      const eligibleAt = nextRepairTick(history, state.autopilotConfig);
      return <li key={id}>{scenario.nodes.find((node) => node.id === id)?.name ?? id}: {state.simulation.services[id]?.local.kind}
        {history.cause ? ` (${history.cause})` : ""} · repairs {history.repairActions}/{state.autopilotConfig.maxRepairsPerInstance} · detected failures {history.failures}
        {eligibleAt !== null ? ` · cooldown ends before tick ${eligibleAt}` : " · no failure cooldown pending"}.</li>;
    })}</ul>
    <ControllerDecisions decisions={state.controller.decisions} />
  </div>;
}

const rows: readonly { label: string; key: keyof AutopilotMetrics }[] = [
  { label: "Recovery actions", key: "recoveryActions" },
  { label: "Repair cycles followed by local failure", key: "failedRecoveryAttempts" },
  { label: "Repeated instance failures", key: "repeatedInstanceFailures" },
  { label: "Offline service-ticks (all services)", key: "offlineServiceTicks" },
  { label: "Completed unique gateway requests", key: "completedUniqueRequests" },
  { label: "Abandoned gateway requests", key: "abandonedRequests" },
  { label: "Remaining backlog", key: "pendingRequests" },
  { label: "Time to stable recovery", key: "stableRecoveryTick" },
  { label: "Stable recovery achieved", key: "stableRecoveryAchieved" },
];

export function AutopilotResults({ comparison }: { comparison: AutopilotComparison }) {
  const runs = [comparison.fixed, comparison.autopilot];
  return <>
    <div className="comparison-scroll" tabIndex={0} role="region" aria-label="Fixed Runbook vs AUTOPILOT results">
      <table className="event-table comparison-table"><caption className="sr-only">Repair policy comparison</caption>
        <thead><tr><th scope="col">Metric</th><th scope="col">Fixed Runbook</th><th scope="col">AUTOPILOT</th></tr></thead>
        <tbody>{rows.map(({ label, key }) => <tr key={key}><th scope="row">{label}</th>{runs.map((run) => {
          const value = run.metrics[key];
          return <td key={run.policy}>{key === "stableRecoveryTick" ? value === null ? "Not recovered" : `Tick ${value}`
            : typeof value === "boolean" ? value ? "Yes" : "No" : value?.toLocaleString("en-US")}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
    <div className="comparison-notes">
      <p>A failed recovery attempt means an accepted repair followed by another local failure before the horizon. An unfinished restart is not confirmed success. Stable recovery uses the existing healthy-pool, empty-backlog, closed-breaker, three-tick definition.</p>
      {runs.map((run) => <div key={run.policy}><p><strong>{run.policy === "fixed-runbook" ? "Fixed Runbook" : "AUTOPILOT"}</strong></p><ControllerDecisions decisions={run.controller.decisions} /></div>)}
    </div>
  </>;
}

export function AutopilotPanel(props: Parameters<typeof AutopilotStatus>[0]) {
  const [comparison, setComparison] = useState<AutopilotComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  return <section className="panel recovery-panel" aria-labelledby="autopilot-heading">
    <div className="incident-toolbar"><div><h2 id="autopilot-heading">AUTOPILOT · Rule-based recovery</h2><p>Deterministic gateway repairs · explicit simulation steps</p></div></div>
    <AutopilotStatus {...props} />
    <div className="incident-toolbar"><div><h3>Fixed Runbook vs AUTOPILOT</h3><p>Isolated 40-tick experiment; leaves manual simulation unchanged.</p></div>
      <button className="button button-secondary" type="button" onClick={() => {
        try { setComparison(compareAutopilot(AUTOPILOT_EXPERIMENT)); setError(null); }
        catch (failure) { setComparison(null); setError(failure instanceof Error ? failure.message : "Comparison failed."); }
      }}>Compare repair policies</button>
    </div>
    <div className="comparison-notes"><p>Both: Normal workload, Adaptive retries with seed 1337 and breaker enabled, fail A at tick 2, cooldown 2 complete ticks, at most 2 repairs/instance and 4 total. Runbook slots: A at 6, B at 7; blocked slots WAIT and are not retried. Failure injection takes priority for both. AUTOPILOT uses only the current snapshot.</p>
      <p>Comparison settings are fixed and independent of the manual controller cooldown above. Only the repair decision policy differs; either policy can perform better.</p></div>
    {error && <p className="action-error" role="alert">{error}</p>}
    {comparison ? <AutopilotResults comparison={comparison} /> : <p className="comparison-empty">Run to calculate results. No recovery outcome is assumed.</p>}
  </section>;
}
