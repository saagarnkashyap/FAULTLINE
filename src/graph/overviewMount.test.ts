// @vitest-environment happy-dom
import { act, createElement as h, forwardRef, useEffect, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import CinematicGraph from "./CinematicGraph";
import { failchainScenario } from "../scenarios/failchain";
import { initializeSimulation, step } from "../simulation/engine";
import type { SimulationState } from "../simulation/types";
import type { GraphLayout } from "./displayLayout";
import type { ServiceGraphData } from "./toGraphData";

const probe = vi.hoisted(() => ({ width: 1100, height: 600, initialized: false, calls: 0,
  resize: null as ResizeObserverCallback | null, camera: null as PerspectiveCamera | null,
  data: null as ServiceGraphData | null }));

vi.mock("react-force-graph-3d", () => ({ default: forwardRef(function Surface(props: {
  width: number; height: number; graphData: ServiceGraphData; onEngineStop: () => void;
}, ref) {
  if (!probe.camera) { probe.camera = new PerspectiveCamera(50, 1, .1, 10000); probe.camera.position.set(0, 0, 500); }
  const camera = probe.camera;
  probe.data = props.graphData;
  const target = new Vector3();
  const controls = { target, enableRotate: false, addEventListener: () => {}, removeEventListener: () => {},
    update: () => { camera.lookAt(controls.target); camera.updateMatrixWorld(); } };
  useImperativeHandle(ref, () => ({
    camera: () => camera, controls: () => controls,
    cameraPosition: (position: Vector3, lookAt: Vector3) => {
      probe.calls++;
      if (!probe.initialized) return; // Reproduce the library ignoring early initialization setters.
      camera.position.copy(position); controls.target.copy(lookAt); controls.update();
    },
    graph2ScreenCoords: (x: number, y: number, z: number) => {
      const point = new Vector3(x, y, z).project(camera);
      return { x: (point.x + 1) * props.width / 2, y: (1 - point.y) * props.height / 2 };
    },
  }), [camera, props.width, props.height]);
  useEffect(() => {
    props.onEngineStop();
    const frame = requestAnimationFrame(() => { probe.initialized = true; });
    return () => cancelAnimationFrame(frame);
  }, [props.onEngineStop]);
  return h("canvas");
}) }));

const initial = initializeSimulation(failchainScenario);
function Harness({ state = initial }: { state?: SimulationState }) {
  return h(CinematicGraph, { scenario: failchainScenario, state, selectedId: "identity", onSelect: () => {}, onLayout: publish });
}
let latest: GraphLayout | null = null;
function publish(layout: GraphLayout) { latest = layout; }

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("mounted overview initialization", () => {
  it("retries an ignored fit, shows all 12 services, preserves camera on state changes, and refits on resize", async () => {
    vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    probe.initialized = false; probe.calls = 0; probe.camera = null; latest = null;
    localStorage.clear();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { probe.resize = callback; }
      observe() { probe.resize!([{ contentRect: { width: probe.width, height: probe.height } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
      disconnect() {}
    });
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(() => root.render(h(Harness)));
      await act(() => vi.advanceTimersByTime(150));
      expect(host.querySelector(".graph-viewport")!.getAttribute("data-ready")).toBe("true");
      const assertVisible = (width: number, height: number) => {
        const layout = latest as unknown as GraphLayout;
        expect(layout.nodes).toHaveLength(12);
        for (const node of layout.nodes) {
          expect(node.left).toBeGreaterThan(0); expect(node.top).toBeGreaterThan(0);
          expect(node.left + node.width).toBeLessThan(width); expect(node.top + node.height).toBeLessThan(height);
        }
      };
      assertVisible(1100, 600);
      const calls = probe.calls, data = probe.data;
      const position = probe.camera!.position.clone();
      const failed = step(failchainScenario, initial, { type: "fail", serviceId: "identity" });
      await act(() => root.render(h(Harness, { state: failed })));
      await act(() => vi.advanceTimersByTime(100));
      expect(probe.data).toBe(data); expect(probe.calls).toBe(calls);
      expect(probe.camera!.position.equals(position)).toBe(true);
      probe.width = 800; probe.height = 560;
      await act(() => probe.resize!([{ contentRect: { width: 800, height: 560 } } as ResizeObserverEntry], {} as ResizeObserver));
      await act(() => vi.advanceTimersByTime(150));
      assertVisible(800, 560);
      expect(probe.calls).toBeGreaterThan(calls);
      expect(probe.data).toBe(data);
    } finally { await act(() => root.unmount()); host.remove(); }
  });
});
