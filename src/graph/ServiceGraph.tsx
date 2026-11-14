import { Component, lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ForceGraphMethods } from "react-force-graph-3d";
import type { ServiceId, SimulationScenario, SimulationState } from "../simulation/types";
import { linkAppearance, nodeAppearance, nodeTooltip } from "./toGraphData";
import type { GraphLink, GraphNode } from "./toGraphData";
import { fitNetwork, resetNetworkCamera } from "./graphView";
import { UI_COLORS } from "../theme";
import { linkTooltip } from "./toGraphData";
import { createDisplayGraph, placeGraphLabels } from "./displayLayout";
import type { ProjectedLabel } from "./displayLayout";
import { GraphLabels } from "./GraphLabels";

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
  const labelRef = useRef<HTMLDivElement>(null);
  const listenerCleanup = useRef<(() => void) | null>(null);
  const boundGraph = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const labelFrame = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [contextLost, setContextLost] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const graphData = useMemo(() => createDisplayGraph(scenario), [scenario]);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotionEnabled(!preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  const updateLabels = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || !labelRef.current) return;
    const labels: ProjectedLabel[] = [];
    const elements = new Map<string, HTMLElement>();
    const camera = graph.camera() as { position?: { x: number; y: number; z: number } } | undefined;
    if (!camera?.position) return;
    const target = (graph.controls() as { target?: { x: number; y: number; z: number } } | undefined)?.target;
    for (const element of labelRef.current.querySelectorAll<HTMLElement>("[data-service-id]")) {
      const id = element.dataset.serviceId!;
      const node = graphData.nodes.find((item) => item.id === id)!;
      const point = graph.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0);
      const inFront = !target || ((node.x ?? 0) - camera.position.x) * (target.x - camera.position.x)
        + ((node.y ?? 0) - camera.position.y) * (target.y - camera.position.y) + ((node.z ?? 0) - camera.position.z) * (target.z - camera.position.z) > 0;
      const visible = inFront && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= size.width && point.y >= 0 && point.y <= size.height;
      element.style.visibility = visible ? "visible" : "hidden";
      if (visible) { labels.push({ id, x: point.x, y: point.y, width: element.offsetWidth, height: element.offsetHeight }); elements.set(id, element); }
    }
    for (const label of placeGraphLabels(labels, size.width, size.height, selectedRef.current)) {
      elements.get(label.id)!.style.transform = `translate(${Math.round(label.left)}px, ${Math.round(label.top)}px)`;
    }
  }, [graphData, size]);
  const refreshLabels = useCallback(() => {
    if (labelFrame.current !== null) cancelAnimationFrame(labelFrame.current);
    labelFrame.current = requestAnimationFrame(() => { labelFrame.current = null; updateLabels(); });
  }, [updateLabels]);
  const bindGraph = useCallback(() => {
    const instance = graphRef.current;
    if (!instance || instance === boundGraph.current) { refreshLabels(); return; }
    listenerCleanup.current?.();
    const controls = instance.controls() as { addEventListener?: (type: string, callback: () => void) => void; removeEventListener?: (type: string, callback: () => void) => void } | undefined;
    if (!controls?.addEventListener || !controls.removeEventListener) return;
    boundGraph.current = instance;
    controls.addEventListener("change", refreshLabels);
    listenerCleanup.current = () => controls.removeEventListener?.("change", refreshLabels);
    refreshLabels();
  }, [refreshLabels]);
  useEffect(() => { refreshLabels(); }, [selectedId, state, refreshLabels]);
  useEffect(() => {
    bindGraph();
    return () => {
      listenerCleanup.current?.(); boundGraph.current = undefined;
      if (labelFrame.current !== null) cancelAnimationFrame(labelFrame.current);
    };
  }, [bindGraph]);

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
  const linkColor = useCallback((link: GraphLink) => linkAppearance(link, state, selectedId).color, [state, selectedId]);
  const linkWidth = useCallback((link: GraphLink) => linkAppearance(link, state, selectedId).width, [state, selectedId]);
  // One slow marker on inspected connections, purely visual; it does not represent traffic.
  const linkParticles = useCallback((link: GraphLink) => motionEnabled && (link.consumerId === selectedId || link.providerId === selectedId) ? 1 : 0, [motionEnabled, selectedId]);
  const linkLabel = useCallback((link: GraphLink) => linkTooltip(link, scenario), [scenario]);
  const onNodeClick = useCallback((node: GraphNode) => onSelect(node.id), [onSelect]);
  const fitView = useCallback(() => { const result = fitNetwork(graphRef.current, size.width, size.height, 0.06); refreshLabels(); return result; }, [size.width, size.height, refreshLabels]);
  const resetView = useCallback(() => { resetNetworkCamera(graphRef.current, size.width, size.height); refreshLabels(); }, [size.width, size.height, refreshLabels]);
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
            nodeRelSize={12}
            nodeResolution={24}
            nodeOpacity={1}
            linkColor={linkColor}
            linkLabel={linkLabel}
            linkWidth={linkWidth}
            linkOpacity={0.9}
            linkDirectionalArrowLength={6}
            linkDirectionalArrowRelPos={0.72}
            linkDirectionalArrowColor={linkColor}
            linkDirectionalArrowResolution={6}
            linkDirectionalParticles={linkParticles}
            linkDirectionalParticleColor={linkColor}
            linkDirectionalParticleWidth={1.5}
            linkDirectionalParticleSpeed={0.002}
            warmupTicks={0}
            cooldownTicks={1}
            onEngineTick={bindGraph}
            onEngineStop={() => { bindGraph(); fitOnce(); }}
            onNodeClick={onNodeClick}
            showNavInfo={false}
            enableNodeDrag={false}
            controlType="orbit"
          />
        </Suspense>
      )}
      {!contextLost && <GraphLabels graph={graphData} state={state} selectedId={selectedId} onSelect={onSelect} containerRef={labelRef} />}
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
