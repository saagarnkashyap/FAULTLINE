import type { CSSProperties, RefObject } from "react";
import type { ServiceGraphData } from "./toGraphData";
import type { SimulationState } from "../simulation/types";
import { STATUS_PRESENTATION } from "../status";

export function GraphLabels({ graph, state, selectedId, onSelect, containerRef }: {
  graph: ServiceGraphData; state: SimulationState; selectedId: string | null; onSelect: (id: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  return <div className="network-label-layer" ref={containerRef} aria-label="Network services">
    {graph.nodes.map((node) => <button key={node.id} data-service-id={node.id} type="button"
      className={`network-node-label ${node.id === selectedId ? "is-selected" : ""}`}
      style={{ "--node-status": STATUS_PRESENTATION[state.services[node.id]!.status].color } as CSSProperties}
      aria-pressed={node.id === selectedId} onClick={() => onSelect(node.id)}>
      <strong>{node.name}</strong><span>{STATUS_PRESENTATION[state.services[node.id]!.status].label}</span>
    </button>)}
  </div>;
}
