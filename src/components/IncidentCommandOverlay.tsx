import { useState } from "react";
import type { IncidentState } from "../incident/incidentState";
import type { CSSProperties } from "react";
import type { ServiceStatus, SimulationScenario } from "../simulation/types";
import { currentImpact, incidentOngoing } from "../incident/incidentState";
import { useWarningCadence } from "../hooks/useWarningCadence";
import { repairTarget } from "./repairAdvice";

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

// Round-robin edges keep even a small incident distributed around the graph.
const slots = [
  { row: 1, column: 2, edge: "top" }, { row: 2, column: 4, edge: "right" },
  { row: 5, column: 3, edge: "bottom" }, { row: 4, column: 1, edge: "left" },
  { row: 1, column: 3, edge: "top" }, { row: 3, column: 4, edge: "right" },
  { row: 5, column: 2, edge: "bottom" }, { row: 3, column: 1, edge: "left" },
  { row: 1, column: 1, edge: "top" }, { row: 4, column: 4, edge: "right" },
  { row: 5, column: 4, edge: "bottom" }, { row: 2, column: 1, edge: "left" },
  { row: 1, column: 4, edge: "top" }, { row: 5, column: 1, edge: "bottom" },
] as const;

export function IncidentCommandOverlay({ state, scenario }: { state: IncidentState; scenario: SimulationScenario }) {
  const [expanded, setExpanded] = useState(true);
  const incident = state.incident;
  const cards = incidentPerimeterCards(state);
  // After the trigger, show future risks while there is still time to act on them.
  const revealOrder = cards.length ? [cards[0]!, ...cards.slice(1).sort((a, b) => (b.leadSteps ?? 0) - (a.leadSteps ?? 0))] : [];
  const revealed = useWarningCadence(expanded ? revealOrder.map(({ serviceId }) => serviceId) : [], `${incident?.startedAtTick ?? "none"}:${incident?.triggerId ?? "none"}`);
  if (!incident) return null;
  const impact = currentImpact(state.app.simulation);
  const ongoing = incidentOngoing(state.app.simulation);
  const tone = impact.offlineIds.length ? "offline" : impact.degradedIds.length ? "degraded"
    : impact.recoveringIds.length ? "recovering" : ongoing ? "degraded" : "healthy";
  const positionOrder = [...new Set([incident.triggerId, ...incident.exposureIds, ...scenario.nodes.map(({ id }) => id)])];
  const name = (id: string) => scenario.nodes.find((node) => node.id === id)?.name ?? id;
  const unavailable = state.prediction?.fromTick === state.app.simulation.tick && state.prediction.unavailable;
  return <aside className={`incident-perimeter perimeter-${tone} ${expanded ? "is-expanded" : "is-minimized"}`} aria-label="Live incident warnings">
    <header className="perimeter-toolbar"><span className="perimeter-incident-label">{incident.criticalActive ? "CASCADE DETECTED" : ongoing ? "LIVE INCIDENT" : "SYSTEM RESTORED"}</span>
      <span className="perimeter-impact">{impact.offlineIds.length} offline · {impact.degradedIds.length} degraded</span>
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={expanded ? "Minimize warnings" : "Show warnings"}>{expanded ? "Minimize" : "Show warnings"}</button>
    </header>
    {expanded && <div className="incident-perimeter-cards" role="list" aria-label="Service warnings around the network">
      {cards.map((card) => {
        const index = positionOrder.indexOf(card.serviceId);
        const slot = slots[index % slots.length]!;
        const repairId = card.status === "healthy" && !card.predicted ? null : repairTarget(card.serviceId, scenario, state.app.simulation);
        const advice = repairId ? `Please repair ${name(repairId)}.` : card.status === "recovering" ? "Recovery in progress." : card.predicted ? "Pause and review the load." : "";
        return <article key={card.serviceId} role="listitem" data-service-id={card.serviceId}
          aria-hidden={!revealed.includes(card.serviceId)}
          className={`incident-mini-card mini-${card.predicted ? "risk" : card.status} edge-${slot.edge} ${revealed.includes(card.serviceId) ? "notice-revealed" : "notice-pending"}`}
          style={{ gridRow: slot.row, gridColumn: slot.column, "--compact-row": index < 6 ? Math.floor(index / 3) + 1 : Math.floor((index - 6) / 3) + 4,
            "--compact-column": index % 3 + 1, "--phone-row": index < 6 ? Math.floor(index / 2) + 1 : Math.floor((index - 6) / 2) + 5,
            "--phone-column": index % 2 + 1 } as CSSProperties} title={card.predicted ? `${name(card.serviceId)}: expected ${card.status} if current conditions continue. Approximate playback timing.` : `${name(card.serviceId)}: ${card.status}`}>
          <span className="mini-card-category">{card.category}</span><h3>{name(card.serviceId)}</h3><strong>{card.detail}</strong>{advice && <p className="mini-card-advice">{state.app.simulation.tick >= scenario.config.maxTicks ? "Reset to continue." : advice}</p>}
        </article>;
      })}
    </div>}
    {expanded && <p className="perimeter-caption">{unavailable ? "Forecast unavailable. Showing confirmed status only." : cards.some(({ predicted }) => predicted) ? "Approximate playback timing · new warnings every 2 seconds" : "Confirmed service status · new warnings every 2 seconds"}</p>}
  </aside>;
}
