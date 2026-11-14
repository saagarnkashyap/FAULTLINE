import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { createDisplayGraph, overlaps, placeIncidentCards } from "./displayLayout";
import { calculateNetworkFit, NODE_LABEL_WIDTH, NODE_LABEL_HEIGHT } from "./graphView";
import { dependencyCurve } from "./edgeRouting";
import { failchainScenario } from "../scenarios/failchain";

function projected(width: number, height: number) {
  const graph = createDisplayGraph(failchainScenario);
  const fit = calculateNetworkFit(graph.nodes, width, height, 50)!;
  const camera = new PerspectiveCamera(50, width / height, .1, 10000);
  camera.position.copy(fit.position); camera.lookAt(fit.target); camera.updateMatrixWorld();
  const nodes = graph.nodes.map((node) => {
    const point = new Vector3(node.x, node.y, node.z).project(camera);
    return { id: node.id, left: (point.x + 1) * width / 2 - NODE_LABEL_WIDTH / 2,
      top: (1 - point.y) * height / 2 - NODE_LABEL_HEIGHT / 2, width: NODE_LABEL_WIDTH, height: NODE_LABEL_HEIGHT };
  });
  return { graph, layout: { width, height, nodes } };
}

describe("full-panel dependency overview", () => {
  it("does not reserve a clipped inner canvas or reposition services into a grid", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.graph-safe-area\s*\{[^}]*inset:\s*0;/);
    expect(css).not.toContain("--warning-side");
  });

  it.each([{ width: 800, height: 560 }, { width: 1100, height: 600 }, { width: 1250, height: 640 }])("fits every service in the $width pixel overview", ({ width, height }) => {
    const { layout } = projected(width, height);
    expect(layout.nodes).toHaveLength(12);
    for (let index = 0; index < layout.nodes.length; index++) {
      const node = layout.nodes[index]!;
      expect(node.left).toBeGreaterThanOrEqual(12);
      expect(node.left + node.width).toBeLessThanOrEqual(width - 12);
      expect(node.top).toBeGreaterThanOrEqual(72);
      expect(node.top + node.height).toBeLessThanOrEqual(height - 52);
      for (const other of layout.nodes.slice(index + 1)) expect(overlaps(node, other, 0), `${node.id} overlaps ${other.id}`).toBe(false);
    }
    const notices = placeIncidentCards(["gateway", "assistant", "crm", "support", "calendar"], layout);
    for (const notice of notices.values()) {
      for (const node of layout.nodes) expect(overlaps(notice, node, 12)).toBe(false);
      expect(notice.top).toBeGreaterThanOrEqual(80);
    }
    expect(notices.size).toBeLessThanOrEqual(3);
  });

  it.each([800, 1100])("keeps curved dependencies clear of unrelated badges at %d pixels", (width) => {
    const { graph, layout } = projected(width, 600);
    const fit = calculateNetworkFit(graph.nodes, width, 600, 50)!;
    const camera = new PerspectiveCamera(50, width / 600, .1, 10000);
    camera.position.copy(fit.position); camera.lookAt(fit.target); camera.updateMatrixWorld();
    const crossings = new Set<string>();
    for (const link of graph.links) {
      const a = graph.nodes.find(({ id }) => id === link.consumerId)!;
      const b = graph.nodes.find(({ id }) => id === link.providerId)!;
      const curve = dependencyCurve(link, new Vector3(a.x, a.y, a.z), new Vector3(b.x, b.y, b.z));
      for (let sample = 0; sample <= 100; sample++) {
        const point = curve.getPoint(sample / 100).project(camera);
        const x = (point.x + 1) * width / 2, y = (1 - point.y) * 300;
        expect(x, `${a.id} -> ${b.id} clipped horizontally`).toBeGreaterThanOrEqual(8);
        expect(x).toBeLessThanOrEqual(width - 8);
        expect(y, `${a.id} -> ${b.id} clipped vertically`).toBeGreaterThanOrEqual(8);
        expect(y).toBeLessThanOrEqual(600 - 44);
      }
      for (const rect of layout.nodes.filter(({ id }) => id !== a.id && id !== b.id)) {
        for (let sample = 1; sample < 100; sample++) {
          const point = curve.getPoint(sample / 100).project(camera);
          const x = (point.x + 1) * width / 2, y = (1 - point.y) * 300;
          const inside = x > rect.left && x < rect.left + rect.width && y > rect.top && y < rect.top + rect.height;
          if (inside) crossings.add(`${a.id} -> ${b.id} crosses ${rect.id}`);
        }
      }
    }
    expect([...crossings]).toEqual([]);
  });
});
