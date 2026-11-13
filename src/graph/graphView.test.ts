import { describe, expect, it, vi } from "vitest";
import { fitNetwork } from "./graphView";

describe("network framing", () => {
  it("fits a laptop canvas with a compact edge margin without requesting an animation", () => {
    const graph = { zoomToFit: vi.fn() };
    expect(fitNetwork(graph, 700, 380)).toBe(true);
    expect(graph.zoomToFit).toHaveBeenCalledExactlyOnceWith(0, 22);
  });

  it("bounds the margin on large and very small canvases", () => {
    const graph = { zoomToFit: vi.fn() };
    fitNetwork(graph, 1800, 1000);
    expect(graph.zoomToFit).toHaveBeenLastCalledWith(0, 28);
    fitNetwork(graph, 20, 40);
    expect(graph.zoomToFit).toHaveBeenLastCalledWith(0, 5);
  });

  it("waits for a graph and a measurable container before marking framing complete", () => {
    const graph = { zoomToFit: vi.fn() };
    expect(fitNetwork(undefined, 700, 380)).toBe(false);
    expect(fitNetwork(graph, 0, 380)).toBe(false);
    expect(fitNetwork(graph, 700, 0)).toBe(false);
    expect(graph.zoomToFit).not.toHaveBeenCalled();
    expect(fitNetwork(graph, 700, 380)).toBe(true);
  });
});
