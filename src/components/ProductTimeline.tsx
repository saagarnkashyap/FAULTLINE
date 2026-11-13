import { useEffect, useRef } from "react";
import type { SimulationEvent, SimulationScenario } from "../simulation/types";
import { formatTime } from "./productCopy";

export function ProductTimeline({ events, scenario }: { events: readonly SimulationEvent[]; scenario: SimulationScenario }) {
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const name = (id: string) => scenario.nodes.find((node) => node.id === id)?.name ?? id;
  const meaningful = events.filter((event) => event.type === "status-changed" || event.type === "overload-started" || (event.type === "command-applied" && event.command === "repair"));
  const overloads = new Set(meaningful.filter((event) => event.type === "overload-started").map((event) => `${event.tick}:${event.serviceId}`));
  const entries = meaningful.filter((event) => !(event.type === "status-changed" && event.to === "recovering")
    && !(event.type === "status-changed" && event.to === "degraded" && overloads.has(`${event.tick}:${event.serviceId}`))).slice(-80);
  useEffect(() => { if (!events.length) follow.current = true; if (viewport.current && follow.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [events.length]);
  return <div className="product-timeline" ref={viewport} tabIndex={0} role="region" aria-label="Incident timeline" onScroll={(event) => {
    const element = event.currentTarget; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
  }}>
    {!entries.length ? <p className="comparison-empty">No incidents yet.</p> : <ol>{entries.map((event, index) => {
      const status = event.type === "status-changed" ? event.to : event.type === "overload-started" ? "degraded" : "recovering";
      const label = event.type === "command-applied" ? "Recovery started" : event.type === "overload-started" ? "overloaded" : event.type === "status-changed" ? event.to === "healthy" ? "restored" : event.to : "";
      return <li key={`${event.tick}:${event.serviceId}:${event.type}:${index}`} className={`timeline-status-${status}`}>
        <time>{formatTime(event.tick, scenario.config.tickDurationMs)}</time><span className="timeline-marker" /><div><strong>{name(event.serviceId)} <span>{label}</span></strong>
          {event.type === "status-changed" && event.providerIds.length > 0 && <p>Cause: {event.providerIds.map(name).join(", ")}</p>}</div>
      </li>;
    })}</ol>}
  </div>;
}
