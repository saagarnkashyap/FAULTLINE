import type { CSSProperties, RefObject } from "react";
import type { ServiceGraphData } from "./toGraphData";
import type { SimulationState } from "../simulation/types";
import { STATUS_PRESENTATION } from "../status";
import { ServiceIcon } from "../components/ServiceIcon";

export function GraphLabels({ graph, state, selectedId, onSelect, containerRef }: {
  graph: ServiceGraphData; state: SimulationState; selectedId: string | null; onSelect: (id: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  return <div className="network-label-layer" ref={containerRef} aria-label="Network services">
    {graph.nodes.map((node) => <button key={node.id} data-service-id={node.id} data-status={state.services[node.id]!.status} type="button"
      className={`network-node-label ${node.id === selectedId ? "is-selected" : ""}`}
      style={{ "--node-status": STATUS_PRESENTATION[state.services[node.id]!.status].color } as CSSProperties}
      aria-pressed={node.id === selectedId} onClick={() => onSelect(node.id)}>
      <ServiceIcon serviceId={node.id} /><span className="node-label-copy"><strong>{node.name}</strong><span className="node-label-status">{STATUS_PRESENTATION[state.services[node.id]!.status].label}</span></span>
    </button>)}
  </div>;
}
