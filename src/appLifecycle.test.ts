// @vitest-environment happy-dom
import { act, createElement as h, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphProps } from "./graph/ServiceGraph";
import App from "./App";
import { UI_COLORS } from "./theme";

// Only the GPU surface is mocked; App, playback and engine are real.
const probe = vi.hoisted(() => ({ mounts: 0, unmounts: 0, latest: null as GraphProps | null,
  scene: null as { camera: { x: number; y: number; z: number }; positions: object } | null }));
vi.mock("./graph/ServiceGraph", () => ({
  ServiceGraph(props: GraphProps) {
    const scene = useRef({ camera: { x: 100, y: 40, z: 800 }, positions: { identity: [12, 30, 4] } });
    probe.latest = props; probe.scene = scene.current;
    useEffect(() => { probe.mounts++; return () => { probe.unmounts++; }; }, []);
    return h("div", { "data-testid": "graph-surface" });
  },
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); probe.mounts = 0; probe.unmounts = 0;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount()); host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

async function click(button: HTMLButtonElement) { await act(() => button.click()); }
function button(text: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((element) => {
    const label = element.cloneNode(true) as HTMLElement;
    for (const hidden of label.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
    return label.textContent?.trim() === text;
  });
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
describe("mounted command console lifecycle", () => {
  it("preserves selection, graph instance/camera, live timer, history and recovery across rerenders", async () => {
    await act(() => root.render(h(App)));
    const service = [...host.querySelectorAll(".service-name")].find((element) => element.textContent === "Gateway Instance A")!;
    await click(service.closest("button")!);
    await click(button("Fail service"));
    expect(host.querySelector(".command-center")!.getAttribute("data-incident")).toBe("critical");
    // happy-dom clamps meter property getters to 0..1 even with max=12; inspect the rendered attributes.
    expect(Number(host.querySelector(".roster-readiness meter")!.getAttribute("value"))).toBeLessThan(12);
    const failed = probe.latest!.state;
    const scene = probe.scene;
    const scenario = probe.latest!.scenario;
    const camera = structuredClone(scene!.camera);
    await act(() => vi.advanceTimersByTime(1000));
    await act(() => root.render(h(App)));
    expect(probe.latest!.state).toBe(failed);
    expect(probe.latest!.state.events).toBe(failed.events);
    expect(probe.latest!.selectedId).toBe("gateway-a");
    expect(probe.latest!.scenario).toBe(scenario);
    expect(probe.scene).toBe(scene); expect(probe.scene!.camera).toEqual(camera);
    expect(probe.mounts).toBe(1); expect(probe.unmounts).toBe(0);
    await act(() => vi.advanceTimersByTime(1000));
    expect(probe.latest!.state.tick).toBe(failed.tick + 1); // Original 2s playback timer was not restarted.
    await click(button("Repair"));
    const recovering = probe.latest!.state;
    expect(recovering.services["gateway-a"]!.local.kind).toBe("recovering");
    await act(() => root.render(h(App)));
    expect(probe.latest!.state).toBe(recovering);
    expect(probe.latest!.state.events).toBe(recovering.events);
    expect(probe.scene).toBe(scene);
    expect(probe.mounts).toBe(1);
    await click(button("Step")); await click(button("Step"));
    expect(probe.latest!.state.services["gateway-a"]!.local.kind).toBe("ready");
    await click(button("Reset"));
    expect(probe.latest!.state.tick).toBe(0);
    expect(probe.latest!.state.events).toHaveLength(0);
    expect(host.querySelector(".command-center")!.getAttribute("data-incident")).toBe("idle");
    expect(host.querySelector(".roster-readiness meter")!.getAttribute("value")).toBe("12");
    expect(host.querySelector(".roster-readiness meter")!.getAttribute("max")).toBe("12");
    expect(probe.latest!.selectedId).toBe("gateway-a");
    expect(probe.scene).toBe(scene);
  });

  it("ignores a legacy light preference and exposes only the fixed command preset", async () => {
    localStorage.setItem("faultline-theme", "light");
    await act(() => root.render(h(App)));
    expect(host.querySelector(".terminal-command")).not.toBeNull();
    expect(host.querySelector(".theme-toggle")).toBeNull();
    expect(host.querySelector<HTMLElement>(".command-center")!.style.getPropertyValue("--bg")).toBe(UI_COLORS.bg);
    await click(button("Compare recovery"));
    const results = host.querySelector(".comparison-table")!;
    expect(results).not.toBeNull();
    const contents = results.textContent;
    await act(() => root.render(h(App)));
    expect(host.querySelector<HTMLElement>(".command-center")!.style.getPropertyValue("--graph")).toBe(UI_COLORS.graph);
    expect(host.querySelector(".comparison-table")).toBe(results);
    expect(results.textContent).toBe(contents);
    expect(probe.mounts).toBe(1);
  });
});
