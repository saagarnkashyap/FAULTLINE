import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../App";
import { createWarningCadence, WARNING_GAP_MS } from "./warningCadence";
import { repairTarget } from "./repairAdvice";
import { createIncidentState, reduceIncidentState } from "../incident/incidentState";
import { failchainScenario } from "../scenarios/failchain";
import { IncidentCommandOverlay } from "./IncidentCommandOverlay";
import { GRAPH_FRAME, GRAPH_FRAME_STYLE } from "../graph/frameLayout";
import { PLAYBACK_INTERVAL_MS } from "../hooks/useIncidentPlayback";

afterEach(() => vi.useRealTimers());

describe("amber warning cadence and safe frame", () => {
  it("reveals one new box every two seconds and never resets the gap on a live update", () => {
    vi.useFakeTimers();
    const notices: { ids: readonly string[]; time: number }[] = [];
    const queue = createWarningCadence((ids) => notices.push({ ids, time: Date.now() }), ["root"]);
    expect(WARNING_GAP_MS).toBe(2000);
    expect(PLAYBACK_INTERVAL_MS).toBe(2000);
    queue.update(["root", "a", "b"]);
    vi.advanceTimersByTime(1000);
    queue.update(["root", "b", "a"]);
    vi.advanceTimersByTime(999);
    expect(notices).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(notices[0]!.ids).toEqual(["root", "b"]);
    vi.advanceTimersByTime(1999);
    expect(notices).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(notices[1]!.ids).toEqual(["root", "b", "a"]);
    expect(notices[1]!.time - notices[0]!.time).toBe(2000);
    expect(vi.getTimerCount()).toBe(0);
    queue.dispose();
  });

  it("cancels on minimize/reset/unmount and ignores vanished or previously shown warnings", () => {
    vi.useFakeTimers();
    const reveal = vi.fn();
    const queue = createWarningCadence(reveal, ["root"]);
    queue.update(["root", "a"]);
    queue.update([]);
    vi.advanceTimersByTime(4000);
    expect(reveal).not.toHaveBeenCalled();
    queue.update(["root", "b"]);
    vi.advanceTimersByTime(2000);
    expect(reveal).toHaveBeenCalledExactlyOnceWith(["root", "b"]);
    queue.update(["root"]);
    queue.update(["root", "b"]);
    vi.advanceTimersByTime(4000);
    expect(reveal).toHaveBeenCalledTimes(1);
    queue.update(["root", "c"]);
    queue.dispose();
    vi.runAllTimers();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    queue.update(["new"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("survives StrictMode setup/cleanup/setup without duplicate reveals", () => {
    vi.useFakeTimers();
    const reveal = vi.fn();
    const first = createWarningCadence(reveal, ["root"]);
    first.update(["root", "a"]);
    first.dispose();
    const second = createWarningCadence(reveal, ["root"]);
    second.update(["root", "a"]);
    vi.advanceTimersByTime(2000);
    expect(reveal).toHaveBeenCalledTimes(1);
    second.dispose();
  });

  it("suggests an actual failed provider instead of repairing a dependency-only outage", () => {
    let state = reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "app", action: { type: "select", serviceId: "gateway" } });
    state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "fail" } });
    expect(repairTarget("calendar", failchainScenario, state.app.simulation)).toBe("gateway");
    const html = renderToStaticMarkup(createElement(IncidentCommandOverlay, { state, scenario: failchainScenario }));
    expect(html).toContain("May go down in ~2 seconds");
    expect(html).toContain("Please repair API Gateway.");
    expect(html).toContain("notice-pending");
    expect(html).toContain('aria-hidden="true"');
    const paused = reduceIncidentState(failchainScenario, state, { type: "pause" });
    const pausedHtml = renderToStaticMarkup(createElement(IncidentCommandOverlay, { state: paused, scenario: failchainScenario }));
    expect(pausedHtml).toContain("in 1 step");
    expect(pausedHtml).not.toContain("May go down in");
    const repaired = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "repair" } });
    expect(repairTarget("calendar", failchainScenario, repaired.app.simulation)).toBeNull();
  });

  it("finds failed gateway peers for load-related risk and never offers a healthy repair", () => {
    let state = reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "app", action: { type: "select", serviceId: "gateway-a" } });
    state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "fail" } });
    expect(repairTarget("gateway-b", failchainScenario, state.app.simulation)).toBe("gateway-a");
    expect(repairTarget("billing", failchainScenario, state.app.simulation)).toBeNull();
  });

  it("reserves disjoint card rails and a separate clipped graph viewport", () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('class="graph-safe-area"');
    expect(GRAPH_FRAME).toMatchObject({ side: 0, top: 0, bottom: 0 });
    expect(GRAPH_FRAME_STYLE).toMatchObject({ "--warning-card-width": "210px", "--warning-card-height": "96px" });
  });
});
