import { describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { calculateNetworkFit, fitNetwork, resetNetworkCamera, NODE_LABEL_WIDTH, NODE_LABEL_HEIGHT } from "./graphView";
import { createDisplayGraph, placeGraphLabels } from "./displayLayout";
import { failchainScenario } from "../scenarios/failchain";

const nodes = createDisplayGraph(failchainScenario).nodes;
function stub() {
  const camera = new PerspectiveCamera(50, 1, .1, 10000);
  camera.position.set(400, 250, 900);
  const controls = { target: new Vector3(), update: () => { camera.lookAt(controls.target); camera.updateMatrixWorld(); } };
  return { camera: () => camera, controls: () => controls, cameraPosition: vi.fn((position: Vector3, target: Vector3, _duration: number) => { camera.position.copy(position); controls.target.copy(target); }) };
}

describe("card-aware network framing", () => {
  it.each([{ width: 800, height: 560 }, { width: 1100, height: 600 }, { width: 1250, height: 640 }])("shows all services on their own anchors without overlap at $width pixels", ({ width, height }) => {
    const fit = calculateNetworkFit(nodes, width, height, 50)!;
    const camera = new PerspectiveCamera(50, width / height, .1, 10000);
    camera.position.copy(fit.position); camera.lookAt(fit.target); camera.updateMatrixWorld();
    const labels = nodes.map((node) => {
      const point = new Vector3(node.x, node.y, node.z).project(camera);
      return { id: node.id, x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2, width: NODE_LABEL_WIDTH, height: NODE_LABEL_HEIGHT };
    });
    for (const label of labels) {
      expect(label.x - NODE_LABEL_WIDTH / 2).toBeGreaterThanOrEqual(width * .059);
      expect(label.x + NODE_LABEL_WIDTH / 2).toBeLessThanOrEqual(width * .941);
      expect(label.y - NODE_LABEL_HEIGHT / 2).toBeGreaterThanOrEqual(70);
      expect(label.y + NODE_LABEL_HEIGHT / 2).toBeLessThanOrEqual(height - 70);
    }
    const span = Math.max((Math.max(...labels.map(({ x }) => x)) - Math.min(...labels.map(({ x }) => x)) + NODE_LABEL_WIDTH) / width,
      (Math.max(...labels.map(({ y }) => y)) - Math.min(...labels.map(({ y }) => y)) + NODE_LABEL_HEIGHT) / height);
    expect(span).toBeGreaterThanOrEqual(.65); expect(span).toBeLessThanOrEqual(.9);
    const placed = placeGraphLabels(labels, width, height, "gateway");
    for (let index = 0; index < placed.length; index++) {
      const a = placed[index]!;
      for (const b of placed.slice(index + 1)) expect(a.left + NODE_LABEL_WIDTH <= b.left || b.left + NODE_LABEL_WIDTH <= a.left || a.top + NODE_LABEL_HEIGHT <= b.top || b.top + NODE_LABEL_HEIGHT <= a.top).toBe(true);
    }
  });

  it("preserves orientation on Fit, resets to front only on Reset Camera, and uses smooth transitions", () => {
    const graph = stub();
    const before = graph.camera().position.clone();
    expect(fitNetwork(graph, 800, 600, nodes)).toBe(true);
    const [position, target] = graph.cameraPosition.mock.calls[0]!;
    const duration = (graph.cameraPosition.mock.calls[0] as unknown[])[2];
    expect(new Vector3().subVectors(position, target).normalize().distanceTo(before.normalize())).toBeLessThan(.0001);
    expect(duration).toBe(500);
    resetNetworkCamera(graph, 800, 600, nodes, 0);
    const [front, center] = graph.cameraPosition.mock.calls[1]!;
    const immediate = (graph.cameraPosition.mock.calls[1] as unknown[])[2];
    expect(front.x).toBe(center.x); expect(front.y).toBe(center.y); expect(front.z).toBeGreaterThan(center.z);
    expect(immediate).toBe(0);
  });

  it("waits for a usable viewport and valid geometry", () => {
    const graph = stub();
    expect(fitNetwork(undefined, 800, 600, nodes)).toBe(false);
    expect(fitNetwork(graph, 0, 600, nodes)).toBe(false);
    expect(fitNetwork(graph, 800, 0, nodes)).toBe(false);
    expect(calculateNetworkFit([], 800, 600, 50)).toBeNull();
    expect(calculateNetworkFit(nodes, 20, 40, 50)).toBeNull();
    expect(calculateNetworkFit([{ id: "bad", name: "bad", x: NaN }], 800, 600, 50)).toBeNull();
    expect(graph.cameraPosition).not.toHaveBeenCalled();
  });
});
