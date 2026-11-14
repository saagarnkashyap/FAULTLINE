import { Vector3 } from "three";
import type { PerspectiveCamera } from "three";
import type { GraphNode } from "./toGraphData";

export const NODE_LABEL_WIDTH = 104;
export const NODE_LABEL_HEIGHT = 88;
export const NODE_CLEARANCE = 18;
export const NODE_GLOW_PADDING = 8;
export const FIT_DURATION_MS = 500;

type Point = { x: number; y: number; z: number };
interface CameraTarget {
  camera(): { position: Point; up: Point; fov?: number };
  controls(): object;
  cameraPosition(position: Point, target: Point, duration: number): unknown;
}

/** Fit the projected anchor bounds plus fixed CSS-sized modules, never just the spheres. */
export function calculateNetworkFit(nodes: readonly GraphNode[], width: number, height: number,
  fov: number, direction: Point = { x: 0, y: 0, z: 1 }, cameraUp: Point = { x: 0, y: 1, z: 0 }) {
  if (!nodes.length || width <= NODE_LABEL_WIDTH + 32 || height <= NODE_LABEL_HEIGHT + 100 || !Number.isFinite(fov) || fov <= 0 || fov >= 180) return null;
  const points = nodes.map(({ x = 0, y = 0, z = 0 }) => new Vector3(x, y, z));
  if (points.some((point) => !point.toArray().every(Number.isFinite))) return null;
  const midpoint = (axis: "x" | "y" | "z") => (Math.min(...points.map((point) => point[axis])) + Math.max(...points.map((point) => point[axis]))) / 2;
  const target = new Vector3(midpoint("x"), midpoint("y"), midpoint("z"));
  const forward = new Vector3(direction.x, direction.y, direction.z);
  if (forward.lengthSq() < .0001) forward.set(0, 0, 1);
  forward.normalize();
  const up = new Vector3(cameraUp.x, cameraUp.y, cameraUp.z).normalize();
  const right = new Vector3().crossVectors(up, forward);
  if (right.lengthSq() < .0001) right.crossVectors(new Vector3(0, 0, 1), forward);
  right.normalize(); up.crossVectors(forward, right).normalize();
  const focal = height / (2 * Math.tan(fov * Math.PI / 360));
  // Use the whole panel, allowing room for the root banner, controls, and visible badge bounds.
  const halfWidth = Math.max(1, width * .44 - NODE_LABEL_WIDTH / 2 - NODE_GLOW_PADDING);
  const halfHeight = Math.max(1, height * .5 - 76 - NODE_LABEL_HEIGHT / 2 - NODE_GLOW_PADDING);
  let distance = 40;
  for (const point of points) {
    const relative = point.clone().sub(target);
    const depth = relative.dot(forward);
    distance = Math.max(distance, depth + focal * Math.abs(relative.dot(right)) / halfWidth,
      depth + focal * Math.abs(relative.dot(up)) / halfHeight, depth + 20);
  }
  const position = target.clone().addScaledVector(forward, distance);
  return { position, target, distance };
}

export function fitNetwork(graph: CameraTarget | undefined, width: number, height: number,
  nodes: readonly GraphNode[], options: { duration?: number; front?: boolean } = {}): boolean {
  if (!graph) return false;
  const camera = graph.camera() as PerspectiveCamera;
  // Match the projection to the measured canvas before solving or projecting labels.
  if (width > 0 && height > 0) { camera.aspect = width / height; camera.updateProjectionMatrix?.(); }
  const target = (graph.controls() as { target?: Point }).target ?? { x: 0, y: 0, z: 0 };
  const direction = options.front ? { x: 0, y: 0, z: 1 } : new Vector3(camera.position.x - target.x, camera.position.y - target.y, camera.position.z - target.z);
  const fit = calculateNetworkFit(nodes, width, height, camera.fov, direction, options.front ? { x: 0, y: 1, z: 0 } : camera.up);
  if (!fit) return false;
  const duration = options.duration ?? FIT_DURATION_MS;
  // The library ignores camera setters before its renderer is initialized. Do not mark an ignored fit complete.
  graph.cameraPosition({ x: fit.position.x, y: fit.position.y, z: fit.position.z }, { x: fit.target.x, y: fit.target.y, z: fit.target.z }, duration);
  if (duration === 0) {
    (graph.controls() as { update?: () => void }).update?.();
    camera.updateMatrixWorld?.();
    const actual = graph.camera().position;
    return Math.hypot(actual.x - fit.position.x, actual.y - fit.position.y, actual.z - fit.position.z) < .01;
  }
  return true;
}

export function resetNetworkCamera(graph: CameraTarget | undefined, width: number, height: number,
  nodes: readonly GraphNode[], duration = FIT_DURATION_MS): boolean {
  return fitNetwork(graph, width, height, nodes, { front: true, duration });
}
