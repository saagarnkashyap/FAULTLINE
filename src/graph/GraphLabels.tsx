import type { CSSProperties, RefObject } from "react";
import type { ServiceGraphData } from "./toGraphData";
import type { SimulationState } from "../simulation/types";
import { STATUS_PRESENTATION } from "../status";
import { ServiceIcon } from "../components/ServiceIcon";
import { NODE_LABEL_WIDTH, NODE_LABEL_HEIGHT } from "./graphView";

export function GraphLabels({ graph, state, selectedId, onSelect, containerRef, focusId = selectedId, onHover }: {
  graph: ServiceGraphData; state: SimulationState; selectedId: string | null; onSelect: (id: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  focusId?: string | null; onHover?: (id: string | null) => void;
}) {
  const connected = new Set(graph.links.filter((link) => link.consumerId === focusId || link.providerId === focusId).flatMap((link) => [link.consumerId, link.providerId]));
  return <div className="network-label-layer" ref={containerRef} aria-label="Network services">
    {graph.nodes.map((node) => <button key={node.id} data-service-id={node.id} data-status={state.services[node.id]!.status} type="button"
      className={`network-node-label ${node.id === selectedId ? "is-selected" : ""} ${connected.has(node.id) ? "is-connected" : ""}`}
      onPointerEnter={() => onHover?.(node.id)} onPointerLeave={() => onHover?.(null)}
      style={{ width: NODE_LABEL_WIDTH, height: NODE_LABEL_HEIGHT, "--node-status": `var(--${state.services[node.id]!.status})`, "--node-status-text": `var(--${state.services[node.id]!.status}-text)` } as CSSProperties}
      aria-pressed={node.id === selectedId} onClick={() => onSelect(node.id)}>
      <svg className="node-frame" viewBox="0 0 104 88" aria-hidden="true"><path d="M8 1H96L103 8V80L96 87H8L1 80V8Z" /><path className="node-frame-accent" d="M1 22V8L8 1H28M76 87H96L103 80V66" /></svg>
      <span className="node-card-face"><ServiceIcon serviceId={node.id} /><span className="node-label-copy"><strong>{node.name}</strong><span className="node-label-status"><i />{STATUS_PRESENTATION[state.services[node.id]!.status].label}</span></span></span>
    </button>)}
  </div>;
}
