interface FramingTarget {
  zoomToFit: (durationMs: number, padding: number) => unknown;
}

/** Share the same framing for first layout and the Fit Network control. */
export function fitNetwork(graph: FramingTarget | undefined, width: number, height: number, edgeRatio = 0.06): boolean {
  if (!graph || width <= 0 || height <= 0) return false;
  const shortestSide = Math.min(width, height);
  // Leave a small edge margin without shrinking the graph on short canvases.
  const padding = Math.floor(Math.min(28, Math.max(12, shortestSide * edgeRatio), shortestSide / 4));
  graph.zoomToFit(0, padding);
  return true;
}

/** Explicit camera-only action; topology, settled coordinates, and simulation are untouched. */
export function resetNetworkCamera(graph: (FramingTarget & { cameraPosition: (position: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, durationMs: number) => unknown }) | undefined, width: number, height: number): boolean {
  if (!graph || width <= 0 || height <= 0) return false;
  graph.cameraPosition({ x: 0, y: 0, z: 600 }, { x: 0, y: 0, z: 0 }, 0);
  return fitNetwork(graph, width, height, 0.035);
}
