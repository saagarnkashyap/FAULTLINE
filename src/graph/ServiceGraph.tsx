import { Component, lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ForceGraphMethods } from "react-force-graph-3d";
import type { ServiceId, SimulationScenario, SimulationState } from "../simulation/types";
import { nodeAppearance, nodeTooltip, toGraphData } from "./toGraphData";
import type { GraphLink, GraphNode } from "./toGraphData";
import { fitNetwork, resetNetworkCamera } from "./graphView";
import { UI_COLORS } from "../theme";
import { linkTooltip } from "./toGraphData";

const ForceGraph3D = lazy(async () => {
  const module = await import("react-force-graph-3d");
  return { default: module.default<GraphNode, GraphLink> };
});

export function GraphUnavailable() {
  return (
    <div className="graph-message" role="status">
      <span className="graph-message-icon" aria-hidden="true">◇</span>
      <h3>3D view unavailable</h3>
      <p>This browser could not render the WebGL network. Select a service from the list to continue.</p>
      <p>Failure, repair, stepping, and the incident log remain available.</p>
    </div>
  );
}

class GraphErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <GraphUnavailable /> : this.props.children;
  }
}

interface Props {
  scenario: SimulationScenario;
  state: SimulationState;
  selectedId: ServiceId | null;
  onSelect: (id: ServiceId) => void;
  recentIds?: readonly ServiceId[];
}

function Network({ scenario, state, selectedId, onSelect, recentIds }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const fitted = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [contextLost, setContextLost] = useState(false);
  const graphData = useMemo(() => toGraphData(scenario), [scenario]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    });
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setContextLost(true);
    };
    observer.observe(container);
    container.addEventListener("webglcontextlost", onContextLost, true);
    return () => {
      observer.disconnect();
      container.removeEventListener("webglcontextlost", onContextLost, true);
    };
  }, []);

  // New appearance accessors update materials/size, not graphData or the camera.
  const nodeColor = useCallback((node: GraphNode) => nodeAppearance(node.id, state, selectedId).color, [state, selectedId]);
  const nodeVal = useCallback((node: GraphNode) => nodeAppearance(node.id, state, selectedId, recentIds).size, [state, selectedId, recentIds]);
  const nodeLabel = useCallback((node: GraphNode) => nodeTooltip(node, state, selectedId), [state, selectedId]);
  const linkColor = useCallback((link: GraphLink) => {
    const related = link.consumerId === selectedId || link.providerId === selectedId;
    return related ? UI_COLORS.interaction : link.kind === "required" ? UI_COLORS["link-required"]
      : link.kind === "pool-member" ? UI_COLORS["link-pool"] : UI_COLORS["link-optional"];
  }, [selectedId]);
  const linkWidth = useCallback((link: GraphLink) =>
    link.consumerId === selectedId || link.providerId === selectedId ? 1.8 : link.kind === "optional" ? 0.7 : 1, [selectedId]);
  const linkLabel = useCallback((link: GraphLink) => linkTooltip(link, scenario), [scenario]);
  const onNodeClick = useCallback((node: GraphNode) => onSelect(node.id), [onSelect]);
  const fitView = useCallback(() => fitNetwork(graphRef.current, size.width, size.height, 0.035), [size.width, size.height]);
  const resetView = useCallback(() => resetNetworkCamera(graphRef.current, size.width, size.height), [size.width, size.height]);
  const fitOnce = useCallback(() => {
    if (!fitted.current) fitted.current = fitView();
  }, [fitView]);

  return (
    <div className="graph-viewport" ref={containerRef}>
      {contextLost ? <GraphUnavailable /> : size.width > 0 && size.height > 0 && (
        <Suspense fallback={<div className="graph-message" role="status">Loading the 3D network…</div>}>
          <ForceGraph3D
            ref={graphRef}
            graphData={graphData}
            width={size.width}
            height={size.height}
            backgroundColor={UI_COLORS.graph}
            nodeLabel={nodeLabel}
            nodeColor={nodeColor}
            nodeVal={nodeVal}
            nodeRelSize={8}
            nodeResolution={20}
            nodeOpacity={1}
            linkColor={linkColor}
            linkLabel={linkLabel}
            linkWidth={linkWidth}
            linkOpacity={0.9}
            linkDirectionalArrowLength={4.5}
            linkDirectionalArrowRelPos={0.72}
            linkDirectionalArrowColor={linkColor}
            linkDirectionalArrowResolution={6}
            warmupTicks={80}
            cooldownTicks={100}
            onEngineStop={fitOnce}
            onNodeClick={onNodeClick}
            showNavInfo={false}
            enableNodeDrag={false}
            controlType="orbit"
          />
        </Suspense>
      )}
      {!contextLost && (
        <div className="graph-camera-controls">
          <button className="button button-quiet" type="button" onClick={fitView} title="Frame the current layout without changing its orientation">Fit network</button>
          <button className="button button-quiet" type="button" onClick={resetView} title="Return to a front view and frame the network; service positions stay fixed">Reset camera</button>
        </div>
      )}
    </div>
  );
}

export const ServiceGraph = memo(function ServiceGraph(props: Props) {
  return <GraphErrorBoundary><Network {...props} /></GraphErrorBoundary>;
});
