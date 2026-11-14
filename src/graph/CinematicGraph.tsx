import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import type { ForceGraphMethods } from "react-force-graph-3d";
import type { GraphProps } from "./ServiceGraph";
import { GraphUnavailable } from "./ServiceGraph";
import { linkAppearance, nodeAppearance, nodeTooltip, linkTooltip } from "./toGraphData";
import type { GraphLink, GraphNode } from "./toGraphData";
import { fitNetwork, resetNetworkCamera, FIT_DURATION_MS, NODE_LABEL_WIDTH, NODE_LABEL_HEIGHT } from "./graphView";
import { UI_COLORS } from "../theme";
import { createDisplayGraph, placeGraphLabels } from "./displayLayout";
import type { ProjectedLabel, GraphLayout } from "./displayLayout";
import { GraphLabels } from "./GraphLabels";
import { createCinematicRenderer } from "./cinematicRenderer";
import { linkCurvature } from "./edgeRouting";

export default function CinematicGraph({ scenario, state, selectedId, onSelect, recentIds, onLayout }: GraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const fitted = useRef(false);
  const fittedSize = useRef("");
  const lastPublished = useRef("");
  const initialFrame = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [rotate, setRotate] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const listenerCleanup = useRef<(() => void) | null>(null);
  const boundGraph = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const labelFrame = useRef<number | null>(null);
  const fitRefreshUntil = useRef(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [contextLost, setContextLost] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const graphData = useMemo(() => createDisplayGraph(scenario), [scenario]);
  const visuals = useMemo(() => createCinematicRenderer(graphData), [graphData]);
  useEffect(() => () => visuals.dispose(), [visuals]);
  useEffect(() => { visuals.update(state, selectedId, motionEnabled, hoveredId ?? selectedId); }, [visuals, state, selectedId, motionEnabled, hoveredId]);
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
      if (visible) { labels.push({ id, x: point.x, y: point.y, width: element.offsetWidth || NODE_LABEL_WIDTH, height: element.offsetHeight || NODE_LABEL_HEIGHT }); elements.set(id, element); }
    }
    const positions = placeGraphLabels(labels, size.width, size.height, selectedRef.current);
    for (const label of positions) {
      elements.get(label.id)!.style.transform = `translate(${Math.round(label.left)}px, ${Math.round(label.top)}px)`;
    }
    const layout: GraphLayout = { width: size.width, height: size.height, nodes: positions.map((placed) => ({ ...placed, width: NODE_LABEL_WIDTH, height: NODE_LABEL_HEIGHT })) };
    const signature = JSON.stringify(layout);
    if (signature !== lastPublished.current) { lastPublished.current = signature; onLayout?.(layout); }
  }, [graphData, size, onLayout]);
  const refreshLabels = useCallback(function scheduleLabels(): void {
    if (labelFrame.current !== null) cancelAnimationFrame(labelFrame.current);
    labelFrame.current = requestAnimationFrame(() => { labelFrame.current = null; updateLabels(); if (performance.now() < fitRefreshUntil.current) scheduleLabels(); });
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
  // Direction markers describe dependencies, never measured request traffic.
  const linkParticles = useCallback((link: GraphLink) => motionEnabled && link.kind !== "optional" ? 1 : 0, [motionEnabled]);
  const linkLabel = useCallback((link: GraphLink) => linkTooltip(link, scenario), [scenario]);
  const onNodeClick = useCallback((node: GraphNode) => onSelect(node.id), [onSelect]);
  const fitView = useCallback((initial = false) => {
    const duration = motionEnabled && !initial ? FIT_DURATION_MS : 0;
    const result = fitNetwork(graphRef.current, size.width, size.height, graphData.nodes, { duration, front: initial && !rotate });
    if (result) fitRefreshUntil.current = performance.now() + duration + 32;
    refreshLabels(); return result;
  }, [size.width, size.height, graphData, motionEnabled, refreshLabels, rotate]);
  const resetView = useCallback(() => {
    const duration = motionEnabled ? FIT_DURATION_MS : 0;
    setRotate(false);
    if (resetNetworkCamera(graphRef.current, size.width, size.height, graphData.nodes, duration)) fitRefreshUntil.current = performance.now() + duration + 32;
    refreshLabels();
  }, [size.width, size.height, graphData, motionEnabled, refreshLabels]);
  const fitOnce = useCallback(() => {
    const key = `${size.width}:${size.height}`;
    if (!fitted.current || fittedSize.current !== key) {
      if (fitView(true)) { fitted.current = true; fittedSize.current = key; setReady(true); }
    }
  }, [fitView, size.width, size.height]);

  // Fit after the library's initialization/update pass, and retry ignored early camera setters.
  useEffect(() => {
    let attempts = 0;
    const key = `${size.width}:${size.height}`;
    const settle = () => {
      initialFrame.current = null;
      bindGraph(); fitOnce();
      if ((!fitted.current || fittedSize.current !== key) && attempts++ < 30) initialFrame.current = requestAnimationFrame(settle);
    };
    initialFrame.current = requestAnimationFrame(settle);
    return () => { if (initialFrame.current !== null) cancelAnimationFrame(initialFrame.current); };
  }, [size.width, size.height, bindGraph, fitOnce]);
  useEffect(() => {
    const controls = graphRef.current?.controls() as { enableRotate?: boolean; update?: () => void } | undefined;
    if (controls) { controls.enableRotate = rotate; controls.update?.(); }
  }, [rotate, ready]);

  return (
    <div className="graph-viewport" data-ready={ready} ref={containerRef}>
      {!ready && !contextLost && <div className="graph-preparing" role="status">Preparing all {scenario.nodes.length} services...</div>}
      {contextLost ? <GraphUnavailable /> : size.width > 0 && size.height > 0 && (
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
            linkCurvature={linkCurvature}
            nodeThreeObject={visuals.nodeObject}
            linkThreeObject={visuals.linkObject}
            linkPositionUpdate={visuals.positionLink}
            linkOpacity={0.9}
            linkDirectionalArrowLength={13}
            linkDirectionalArrowRelPos={0.5}
            linkDirectionalArrowColor={linkColor}
            linkDirectionalArrowResolution={6}
            linkDirectionalParticles={linkParticles}
            linkDirectionalParticleColor={linkColor}
            linkDirectionalParticleWidth={3.5}
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
      )}
      {!contextLost && <GraphLabels focusId={hoveredId ?? selectedId} onHover={setHoveredId} graph={graphData} state={state} selectedId={selectedId} onSelect={onSelect} containerRef={labelRef} />}
      {!contextLost && (
        <div className="graph-camera-controls">
          <button className="button button-quiet" type="button" onClick={() => fitView()} title="Frame complete service modules without changing orientation">Fit network</button>
          <button className="button button-quiet" type="button" onClick={resetView} title="Return to a front view and frame the network; service positions stay fixed">Overview</button>
          <button className="button button-quiet" type="button" aria-pressed={rotate} onClick={() => setRotate((value) => !value)} title="Enable or disable 3D rotation">Rotate view</button>
        </div>
      )}
    </div>
  );
}

