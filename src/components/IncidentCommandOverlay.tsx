import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { placeIncidentCards } from "../graph/displayLayout";
import type { GraphLayout } from "../graph/displayLayout";
import type { IncidentState } from "../incident/incidentState";
import type { ServiceStatus, SimulationScenario } from "../simulation/types";
import { currentImpact, incidentOngoing } from "../incident/incidentState";
import { useWarningCadence } from "../hooks/useWarningCadence";
import { repairTarget } from "./repairAdvice";
import { ServiceIcon } from "./ServiceIcon";

interface PerimeterCard {
  readonly serviceId: string;
  readonly status: ServiceStatus;
  readonly category: string;
  readonly detail: string;
  readonly predicted: boolean;
  readonly leadSteps?: number;
}

/** One current-status box per affected service; forecasts never duplicate confirmed impact. */
export function incidentPerimeterCards(state: IncidentState): PerimeterCard[] {
  const incident = state.incident;
  if (!incident) return [];
  const simulation = state.app.simulation;
  const ids = [incident.triggerId, ...Object.keys(simulation.services).filter((id) => id !== incident.triggerId && simulation.services[id]!.status !== "healthy")];
  const cards: PerimeterCard[] = ids.map((serviceId) => {
    const status = simulation.services[serviceId]!.status;
    return { serviceId, status, category: "CONFIRMED NOW", predicted: false,
      detail: status === "healthy" ? "SERVICE RESTORED" : status === "recovering" ? "RECOVERY STARTED" : status.toUpperCase() };
  });
  const prediction = state.prediction?.fromTick === simulation.tick && !state.prediction.unavailable ? state.prediction : null;
  const forecasts = (prediction?.impacts ?? []).filter((item) => !ids.includes(item.serviceId));
  const shown = forecasts.slice(0, 3);
  if (forecasts.length > 3) shown.push(forecasts.find((item) => item.stepsAway > forecasts[0]!.stepsAway && !shown.some((entry) => entry.serviceId === item.serviceId)) ?? forecasts[3]!);
  for (const forecast of shown) cards.push({ serviceId: forecast.serviceId, status: forecast.status, predicted: true, leadSteps: forecast.stepsAway,
    category: forecast.stepsAway === 1 ? "AT RISK NEXT" : "POSSIBLE CASCADE",
    detail: incident.phase === "running" ? `${forecast.status === "offline" ? "May go down" : "May degrade"} in ~${Number(forecast.seconds.toFixed(1))} seconds` : `in ${forecast.stepsAway} ${forecast.stepsAway === 1 ? "step" : "steps"}` });
  return cards;
}

export function IncidentCommandOverlay({ state, scenario, layout, children }: { state: IncidentState; scenario: SimulationScenario; layout?: GraphLayout | null; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const incident = state.incident;
  const cards = incidentPerimeterCards(state);
  const revealOrder = cards.length ? [cards[0]!, ...cards.slice(1).sort((a, b) => (b.leadSteps ?? 0) - (a.leadSteps ?? 0))] : [];
  const revealed = useWarningCadence(expanded ? revealOrder.map(({ serviceId }) => serviceId) : [], `${incident?.startedAtTick ?? "none"}:${incident?.triggerId ?? "none"}`);
  useEffect(() => setExpanded(true), [incident?.startedAtTick, incident?.triggerId]);
  const root = cards[0];
  const available = revealOrder.filter((card) => card !== root && revealed.includes(card.serviceId));
  const placements = expanded && layout ? placeIncidentCards(available.map(({ serviceId }) => serviceId), layout) : new Map();
  const floating = cards.filter((card) => card !== root && placements.has(card.serviceId));
  const logged = cards.filter((card) => card !== root && !placements.has(card.serviceId));
  const impact = currentImpact(state.app.simulation);
  const ongoing = incidentOngoing(state.app.simulation);
  const tone = impact.offlineIds.length ? "offline" : impact.degradedIds.length ? "degraded"
    : impact.recoveringIds.length ? "recovering" : "healthy";
  const name = (id: string) => scenario.nodes.find((node) => node.id === id)?.name ?? id;
  const unavailable = state.prediction?.fromTick === state.app.simulation.tick && state.prediction.unavailable;
  function notice(card: PerimeterCard, style?: CSSProperties, primary = false) {
    const repairId = card.status === "healthy" && !card.predicted ? null : repairTarget(card.serviceId, scenario, state.app.simulation);
    const advice = state.app.simulation.tick >= scenario.config.maxTicks ? "Reset to continue." : repairId ? `Please repair ${name(repairId)}.` : card.status === "recovering" ? "Recovery in progress." : card.predicted ? "Pause and review the load." : "";
    return <article key={card.serviceId} role="listitem" data-service-id={card.serviceId} data-step={state.app.simulation.tick} data-predicted={card.predicted} aria-hidden={!revealed.includes(card.serviceId)}
      className={`incident-mini-card ${primary ? "root-incident-banner" : ""} mini-${card.predicted ? "risk" : card.status} ${revealed.includes(card.serviceId) ? "notice-revealed" : "notice-pending"}`}
      style={style} title={card.predicted ? `${name(card.serviceId)}: expected ${card.status} if current conditions continue. Approximate playback timing.` : `${name(card.serviceId)}: ${card.status}`}>
      <div className="incident-card-surface"><div className="command-only incident-command-strip"><span>{card.predicted ? "CASCADE FORECAST" : card.status === "offline" ? "SYSTEM ALERT" : card.status === "recovering" ? "RECOVERY CHANNEL" : "SERVICE STATUS"}</span><span>STEP {state.app.simulation.tick}</span></div><div className="incident-card-content"><ServiceIcon serviceId={card.serviceId} className="warning-service-icon" />
        <div><span className="mini-card-category">{card.status === "recovering" && !card.predicted ? "RECOVERY ACTIVE" : card.category}</span><h3>{name(card.serviceId)}</h3><strong className="mini-card-status">{card.detail}</strong>
          {!primary && advice && <p className="mini-card-advice">{state.app.simulation.tick >= scenario.config.maxTicks ? "Reset to continue." : advice}</p>}
          {primary && advice && <span className="root-repair-advice">{advice}</span>}
        </div>
      </div></div>
    </article>;
  }
  // The scene is always the first child of this stable wrapper; incident changes never remount it.
  return <div className="network-experience">
    {children}
    {incident && <aside className={`incident-perimeter perimeter-${tone} ${expanded ? "is-expanded" : "is-minimized"}`} aria-label="Live incident warnings" style={{ height: layout?.height ?? "100%" }}>
      <header className="perimeter-toolbar"><span className="perimeter-incident-label">{incident.criticalActive ? "CASCADE DETECTED" : ongoing ? "LIVE INCIDENT" : "SYSTEM RESTORED"}</span>
        <span className="perimeter-impact">{impact.offlineIds.length} offline / {impact.degradedIds.length} degraded</span>
        <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={expanded ? "Minimize warnings" : "Show warnings"}>{expanded ? "Minimize" : "Show warnings"}</button>
      </header>
      {expanded && <div role="list" aria-label="Service warnings around the network">
        {root && notice(root, undefined, true)}
        {floating.map((card) => { const rect = placements.get(card.serviceId)!; return notice(card, { position: "absolute", left: rect.left, top: rect.top, width: rect.width }); })}
      </div>}
    </aside>}
    {incident && expanded ? <details className="notice-log"><summary>{logged.length} more service notices <span>{unavailable ? "Forecast unavailable" : "Current model status / forecasts"}</span></summary>
      <div className="notice-log-items" role="list" aria-label="Additional service warnings">{logged.map((card) => notice(card))}</div>
    </details> : <div className="notice-dock-idle">{incident ? "Warnings minimized" : `${scenario.nodes.length}-service topology`}<span>Hover or select a service to trace its connections</span></div>}
  </div>;
}
