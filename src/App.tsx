import { useCallback, useMemo } from "react";
import { RecoveryComparison } from "./components/RecoveryComparison";
import { IncidentCommandOverlay } from "./components/IncidentCommandOverlay";
import { LiveIncident } from "./components/LiveIncident";
import { ProductTimeline } from "./components/ProductTimeline";
import { ServiceCard } from "./components/ServiceCard";
import { formatTime } from "./components/productCopy";
import { useIncidentPlayback } from "./hooks/useIncidentPlayback";
import { StatusBadge } from "./components/StatusBadge";
import { ServiceIcon } from "./components/ServiceIcon";
import { ServiceGraph } from "./graph/ServiceGraph";
import { GRAPH_FRAME_STYLE } from "./graph/frameLayout";
import { failchainScenario as baseScenario } from "./scenarios/failchain";
import { withWorkload, WORKLOAD_PRESETS } from "./scenarios/workloads";
import type { ServiceId, ServiceStatus } from "./simulation/types";
import { STATUS_PRESENTATION } from "./status";
import { THEME_STYLE } from "./theme";
import { incidentOngoing } from "./incident/incidentState";

export default function App() {
  const { state, dispatch: playback, dispatchApp: dispatch } = useIncidentPlayback(baseScenario);
  const { simulation, selectedId, error, workloadId } = state.app;
  const scenario = useMemo(() => withWorkload(baseScenario, workloadId), [workloadId]);
  const select = useCallback((serviceId: ServiceId) => dispatch({ type: "select", serviceId }), [dispatch]);
  const fail = useCallback(() => dispatch({ type: "fail" }), [dispatch]);
  const repair = useCallback(() => dispatch({ type: "repair" }), [dispatch]);
  const counts = { healthy: 0, degraded: 0, offline: 0, recovering: 0 };
  for (const service of Object.values(simulation.services)) counts[service.status]++;
  const atLimit = simulation.tick >= scenario.config.maxTicks;
  const incidentLabel = state.incident?.phase === "running" ? "LIVE INCIDENT"
    : state.incident ? incidentOngoing(simulation) ? "INCIDENT ONGOING" : "SYSTEM RESTORED" : "SYSTEM READY";
  return <div className="app-shell command-center" style={THEME_STYLE}>
    <a className="skip-link" href="#service-list">Skip to services</a>
    <header className="app-header">
      <div className="brand"><svg className="brand-mark" width="32" height="38" viewBox="0 0 35 38" fill="none" aria-hidden="true"><path d="M4 32V5H28M4 18H17M23 14L14 36" stroke="currentColor" strokeWidth="3" /></svg>
        <div><h1>FAULTLINE</h1><p>CLOUD FAILURE & RECOVERY SIMULATOR</p></div></div>
      <div className={`system-indicator ${counts.offline ? "is-critical" : counts.degraded ? "is-degraded" : counts.recovering ? "is-recovering" : ""}`}><span />{incidentLabel}</div>
      <div className="header-status-strip" aria-label="Live service totals">{(Object.keys(STATUS_PRESENTATION) as ServiceStatus[]).map((status) => <span key={status}><b>{counts[status]}</b><StatusBadge status={status} /></span>)}</div>
      <div className="header-actions">
        <div className="workload-control"><label htmlFor="workload-preset">WORKLOAD</label><select id="workload-preset" value={workloadId} title="Changing traffic resets experiment" onChange={(event) => {
          const preset = Object.values(WORKLOAD_PRESETS).find(({ id }) => id === event.target.value);
          if (preset) dispatch({ type: "workload", workloadId: preset.id });
        }}>{Object.values(WORKLOAD_PRESETS).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></div>
        <div className="tick-display" aria-live={state.incident ? "off" : "polite"} aria-atomic="true"><span>TIME</span><strong>{formatTime(simulation.tick, scenario.config.tickDurationMs)}</strong><small>Step {simulation.tick}</small></div>
        <button className="button button-primary" type="button" disabled={atLimit} onClick={() => dispatch({ type: "step" })} title="Advance one step; pauses playback"><span aria-hidden="true">▸</span>Step</button>
        <button className="button button-secondary" type="button" disabled={state.incident?.phase !== "running"} onClick={() => playback({ type: "pause" })}>Pause</button>
        <button className="button button-secondary" type="button" onClick={() => dispatch({ type: "reset" })}>Reset</button>
      </div>
    </header>
    <main className="workspace">
      <aside className="panel services-panel" aria-labelledby="services-heading">
        <div className="panel-heading"><h2 id="services-heading">Services <span className="count-tag">{scenario.nodes.length}</span></h2><span className="eyebrow">01 / EXPLORE</span></div>
        <nav id="service-list" aria-label="Select a service"><ul className="service-list">{scenario.nodes.map((node, index) => <li key={node.id}>
          <button type="button" className={`service-button ${node.id === selectedId ? "is-selected" : ""}`} aria-pressed={node.id === selectedId} onClick={() => select(node.id)}>
            <span className="service-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span className={`explorer-service-icon icon-${simulation.services[node.id]!.status}`}><ServiceIcon serviceId={node.id} /></span><span className="service-list-label"><span className="service-name">{node.name}</span><StatusBadge status={simulation.services[node.id]!.status} /></span><span className="selection-arrow" aria-hidden="true">›</span>
          </button></li>)}</ul></nav>
        <div className="explorer-footer"><span className="eyebrow">START HERE</span><button type="button" className="dependency-button" onClick={() => select("gateway-a")}>Inspect Gateway A ↗</button>
          <details><summary>How to start</summary><p><strong>FAILCHAIN · Gateway failover</strong></p><p>Fail a gateway and watch its backup take the load.</p><p>Pool membership · either backend can serve</p></details>
        </div>
      </aside>
      <section className={`panel network-panel ${state.incident?.phase === "running" ? "incident-active" : ""} ${state.incident?.criticalActive ? "incident-critical" : ""}`} aria-labelledby="network-heading" style={GRAPH_FRAME_STYLE}>
        <div className="network-heading"><div><p className="eyebrow">ENTERPRISE SANDBOX / 01</p><h2 id="network-heading">Dependency network</h2><p className="network-subtitle">Live topology · Failure impact · Recovery state</p></div><span className="network-mode">3D / LOCAL</span></div>
        <div className="graph-stage">
          <div className="graph-safe-area"><ServiceGraph scenario={baseScenario} state={simulation} selectedId={selectedId} onSelect={select} recentIds={state.incident?.phase === "running" ? state.incident.recentIds : undefined} /></div>
          <IncidentCommandOverlay key={state.incident?.startedAtTick ?? "idle"} state={state} scenario={scenario} />
        </div>
        <div className="graph-footer"><span>Drag to rotate · Scroll to zoom · Click a name to inspect</span><span className="direction-note">Service → needs</span></div>
        <div className="graph-key"><span><i />Required</span><span><i className="optional-line" />Optional</span><span><i className="pool-line" />Backup connection</span><span>Links show provider status</span></div>
      </section>
      <aside className="panel inspector-panel" aria-labelledby="inspector-heading"><div className="panel-heading"><h2 id="inspector-heading">Service inspector</h2><span className="sr-only">Selected service</span></div>
        <ServiceCard scenario={scenario} state={simulation} selectedId={selectedId} onSelect={select} onFail={fail} onRepair={repair} />
      </aside>
      {error && <p role="alert" className="action-error product-error">{error.replace(/tick/gi, "step")}</p>}
      {atLimit && <p role="status" className="limit-message product-error">Time limit reached. Reset to continue.</p>}
      <section className="panel incident-panel" aria-labelledby="timeline-heading"><div className="incident-toolbar"><div><span className="eyebrow">03 / TRACE</span><h2 id="timeline-heading">Incident timeline <span className="count-tag">{simulation.events.filter((event) => event.type === "status-changed").length}</span></h2></div><span className="timeline-note">Confirmed changes only</span></div><ProductTimeline events={simulation.events} scenario={scenario} /></section>
      <details className="incident-details"><summary>Incident controls & impact <span>Playback, affected services, and capacity</span></summary><LiveIncident state={state} scenario={scenario} dispatch={playback} /></details>
      <RecoveryComparison simple />
    </main>
    <footer className="app-footer"><span>FAULTLINE / FAILURE IS A FEATURE.</span><span>Fictional network · Runs locally · No live integrations</span></footer>
  </div>;
}
