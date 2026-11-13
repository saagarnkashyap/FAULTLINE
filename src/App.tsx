import { useCallback, useMemo } from "react";
import { EventLog } from "./components/EventLog";
import { RecoveryComparison } from "./components/RecoveryComparison";
import { AutopilotPanel } from "./components/AutopilotPanel";
import { IncidentOverlay } from "./components/IncidentOverlay";
import { IncidentPlayback } from "./components/IncidentPlayback";
import { useIncidentPlayback } from "./hooks/useIncidentPlayback";
import { ServiceDetails } from "./components/ServiceDetails";
import { StatusBadge } from "./components/StatusBadge";
import { ServiceGraph } from "./graph/ServiceGraph";
import { failchainScenario as baseScenario } from "./scenarios/failchain";
import { withWorkload, WORKLOAD_PRESETS } from "./scenarios/workloads";
import type { ServiceId, ServiceStatus } from "./simulation/types";
import { STATUS_PRESENTATION } from "./status";
import { THEME_STYLE } from "./theme";
import { incidentOngoing } from "./incident/incidentState";

export default function App() {
  const { state: incidentState, dispatch: dispatchIncident, dispatchApp: dispatch } = useIncidentPlayback(baseScenario);
  const appState = incidentState.app;
  const { simulation, selectedId, error, workloadId } = appState;
  const scenario = useMemo(() => withWorkload(baseScenario, workloadId), [workloadId]);
  const selectService = useCallback((serviceId: ServiceId) => dispatch({ type: "select", serviceId }), []);
  const fail = useCallback(() => dispatch({ type: "fail" }), []);
  const repair = useCallback(() => dispatch({ type: "repair" }), []);
  const counts = { healthy: 0, degraded: 0, offline: 0, recovering: 0 };
  for (const service of Object.values(simulation.services)) counts[service.status] += 1;
  const atLimit = simulation.tick >= scenario.config.maxTicks;
  const selected = scenario.nodes.find(({ id }) => id === selectedId);
  const incidentLabel = incidentState.incident?.phase === "running" ? "Incident playback"
    : incidentState.incident ? incidentOngoing(simulation) ? "Incident ongoing" : "Services restored" : "No incident injected";

  return (
    <div className="app-shell" style={THEME_STYLE}>
      <a className="skip-link" href="#service-list">Skip to services</a>
      <header className="app-header">
        <div className="brand">
          <svg className="brand-mark" width="35" height="38" viewBox="0 0 35 38" fill="none" aria-hidden="true">
            <path d="M4 32V5H28M4 18H17M23 14L14 36" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
          </svg>
          <div><h1>FAULTLINE<span className="phase-tag">PHASE 5B</span></h1><p>Cloud Failure &amp; Recovery Simulator</p></div>
        </div>
        <div className="header-actions">
          <div className="workload-control">
            <label htmlFor="workload-preset">Workload · resets experiment</label>
            <select id="workload-preset" value={workloadId} aria-describedby="workload-reset-note" onChange={(event) => {
              const preset = Object.values(WORKLOAD_PRESETS).find(({ id }) => id === event.target.value);
              if (preset) dispatch({ type: "workload", workloadId: preset.id });
            }}>
              {Object.values(WORKLOAD_PRESETS).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
            <span id="workload-reset-note">Changing presets clears the tick, failures, and log.</span>
          </div>
          <div className={`header-incident ${incidentState.incident?.criticalActive ? "is-critical" : ""}`}><span className="eyebrow">SIMULATED ENVIRONMENT</span><strong>{incidentLabel}</strong><span>Local sandbox · no live telemetry</span></div>
          <div className="tick-display" aria-live={incidentState.incident ? "off" : "polite"} aria-atomic="true">
            <span>SIMULATION TICK</span><strong>{String(simulation.tick).padStart(4, "0")}</strong><small>/ {scenario.config.maxTicks}</small>
          </div>
          <button className="button button-primary" type="button" disabled={atLimit} onClick={() => dispatch({ type: "step" })} title="Advance one tick; pauses incident playback before applying the step">Step simulation</button>
          <button className="button button-secondary" type="button" onClick={() => dispatch({ type: "reset" })}>
            <span aria-hidden="true">↺</span> Reset
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="panel services-panel" aria-labelledby="services-heading">
          <div className="panel-heading">
            <h2 id="services-heading">Services <span className="count-tag">{scenario.nodes.length}</span></h2><span className="eyebrow">INVENTORY</span>
          </div>
          <nav id="service-list" aria-label="Select a service">
            <ul className="service-list">
              {scenario.nodes.map((node, index) => {
                const runtime = simulation.services[node.id];
                if (!runtime) return null;
                return (
                  <li key={node.id}>
                    <button type="button" className={`service-button ${node.id === selectedId ? "is-selected" : ""}`}
                      aria-pressed={node.id === selectedId} onClick={() => selectService(node.id)}>
                      <span className="service-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                      <span className="service-list-label"><span className="service-name">{node.name}</span><StatusBadge status={runtime.status} /></span>
                      <span className="selection-arrow" aria-hidden="true">›</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="inventory-note"><span aria-hidden="true">◇</span><div>
            <p><strong>FAILCHAIN · Gateway failover</strong></p>
            <p>On Normal, fail Gateway Instance A to shift 120 requests/tick to Instance B. INCIDENT ZERO plays the actual overload and downstream changes.</p>
            <button className="dependency-button" type="button" onClick={() => selectService("gateway-a")}>Select Gateway Instance A ↗</button>
            <p>Fictional infrastructure · No live connection.</p>
          </div></div>
        </aside>

        <section className={`panel network-panel ${incidentState.incident?.phase === "running" ? "incident-active" : ""} ${incidentState.incident?.criticalActive ? "incident-critical" : ""}`} aria-labelledby="network-heading">
          <div className="network-heading">
            <div><p className="eyebrow">ENTERPRISE SANDBOX / 01</p><h2 id="network-heading">Dependency network</h2></div><span className="network-mode">3D VIEW</span>
          </div>
          <div className="network-stats" aria-label="Current service status totals">
            {(Object.keys(STATUS_PRESENTATION) as ServiceStatus[]).map((status) => (
              <div key={status}><StatusBadge status={status} /><strong>{String(counts[status]).padStart(2, "0")}</strong></div>
            ))}
          </div>
          <div className="graph-stage">
            <ServiceGraph scenario={baseScenario} state={simulation} selectedId={selectedId} onSelect={selectService}
              recentIds={incidentState.incident?.phase === "running" ? incidentState.incident.recentIds : undefined} />
            <IncidentOverlay key={incidentState.incident?.startedAtTick ?? "idle"} incident={incidentState.incident} events={simulation.events} />
            <div className="graph-caption">
              <span className="eyebrow">SELECTED SERVICE</span><strong>{selected?.name ?? "None selected"}</strong>
              <span>Drag to rotate · Scroll to zoom · Click to inspect</span>
            </div>
          </div>
          <div className="graph-footer">
            <span><b>{scenario.nodes.length}</b> services <span className="footer-divider">/</span> <b>{scenario.dependencies.length}</b> dependencies · 1 backend pool</span>
            <span className="direction-note">Consumer <span aria-hidden="true">→</span> provider <span className="muted">· depends on</span></span>
          </div>
          <div className="graph-key">
            <span><i />Required dependency</span><span><i className="optional-line" />Optional dependency (muted)</span>
            <span><i className="pool-line" />Pool membership · either backend can serve</span>
            <span>Selected node: larger size · status color retained</span>
            <span>Failures propagate against the arrows</span>
          </div>
        </section>

        <aside className="panel inspector-panel" aria-labelledby="inspector-heading">
          <div className="panel-heading"><h2 id="inspector-heading">Service inspector</h2><span className="eyebrow">DETAILS</span></div>
          <ServiceDetails scenario={scenario} state={simulation} selectedId={selectedId} onSelect={selectService} onFail={fail} onRepair={repair} autopilot={appState} />
        </aside>

        <IncidentPlayback state={incidentState} scenario={scenario} dispatch={dispatchIncident} />
        <section className="panel incident-panel" aria-labelledby="incident-heading">
          <div className="incident-toolbar">
            <div><h2 id="incident-heading">Incident log <span className="count-tag">{simulation.events.length}</span></h2><p>Engine events · chronological order</p></div>
            <div className="step-controls">
              <span className="step-note">{appState.autopilotEnabled ? "AUTOPILOT ON STEP" : "MANUAL STEPPING"} <span>1 tick = {scenario.config.tickDurationMs / 1000}s simulated</span></span>
              <button className="button button-primary" type="button" disabled={atLimit} onClick={() => dispatch({ type: "step" })}>
                <span aria-hidden="true">▷</span> Step simulation
              </button>
            </div>
          </div>
          {error && <p role="alert" className="action-error">{error}</p>}
          {atLimit && <p role="status" className="limit-message">Tick limit reached. Reset to start another experiment.</p>}
          <EventLog events={simulation.events} scenario={scenario} />
        </section>
        <RecoveryComparison />
        <AutopilotPanel state={appState} scenario={scenario} onToggle={(enabled) => dispatch({ type: "autopilot", enabled })}
          onCooldown={(cooldownTicks) => dispatch({ type: "autopilot-cooldown", cooldownTicks })} />
      </main>
      <footer className="app-footer">
        <span>FAULTLINE <span className="footer-divider">/</span> FAILURE IS A FEATURE.</span>
        <span>Deterministic engine · Local only · Fictional infrastructure</span>
      </footer>
    </div>
  );
}
