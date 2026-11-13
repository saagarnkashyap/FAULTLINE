import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import { failchainScenario } from "../scenarios/failchain";
import { createIncidentState, reduceIncidentState } from "../incident/incidentState";
import { IncidentCommandOverlay } from "./IncidentCommandOverlay";
import { LiveIncident } from "./LiveIncident";
import { ServiceCard } from "./ServiceCard";
import { ProductTimeline } from "./ProductTimeline";
import { GraphLabels } from "../graph/GraphLabels";
import { createDisplayGraph, placeGraphLabels } from "../graph/displayLayout";

describe("simplified command center", () => {
  it("renders the normal dashboard without AUTOPILOT or academic headings", () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).not.toContain("AUTOPILOT");
    expect(html).not.toContain("rule-based recovery");
    expect(html).not.toContain("SIMULATION TICK");
    expect(html).not.toContain("engine-bound");
    expect(html).toContain(">TIME<");
    expect(html).toContain("Incident timeline");
    expect(html).toContain("Selected service");
    expect(html).toContain("Recovery lab");
  });

  it("shows confirmed failure and engine-predicted countdowns, using steps while paused", () => {
    let state = reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "app", action: { type: "fail" } });
    let html = renderToStaticMarkup(createElement(IncidentCommandOverlay, { state, scenario: failchainScenario }));
    expect(html).toContain("CONFIRMED NOW");
    expect(html).toContain("Identity");
    expect(html).toContain("OFFLINE");
    expect(html).toContain("AT RISK NEXT");
    expect(html).toContain("POSSIBLE CASCADE");
    expect(html).toContain("May go down in ~2 seconds");
    expect(html).toContain("May go down in ~4 seconds");
    expect(html).toContain('aria-label="Minimize warnings"');
    state = reduceIncidentState(failchainScenario, state, { type: "pause" });
    html = renderToStaticMarkup(createElement(IncidentCommandOverlay, { state, scenario: failchainScenario }));
    expect(html).toContain("in 1 step");
    expect(html).not.toContain("May go down in");
    expect(html).not.toContain('aria-modal="true"');
  });

  it("replaces predicted warnings with current impacts and never asserts unavailable timing", () => {
    let state = reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "app", action: { type: "fail" } });
    state = reduceIncidentState(failchainScenario, state, { type: "playback-tick", sequence: state.sequence, expectedTick: 1 });
    expect(state.app.simulation.services.gateway!.status).toBe("offline");
    expect(state.prediction!.impacts.some(({ serviceId }) => serviceId === "gateway")).toBe(false);
    const unavailable = { ...state, prediction: { fromTick: state.app.simulation.tick, evaluatedSteps: 0, impacts: [], unavailable: "Prediction unavailable." } };
    const html = renderToStaticMarkup(createElement(IncidentCommandOverlay, { state: unavailable, scenario: failchainScenario }));
    expect(html).toContain("Forecast unavailable");
    expect(html).not.toContain("May go down in");
    expect(html).toContain("CASCADE DETECTED");
  });

  it("keeps settled outages ongoing and retains playback controls in simple language", () => {
    let state = reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "app", action: { type: "fail" } });
    state = reduceIncidentState(failchainScenario, state, { type: "skip" });
    const html = renderToStaticMarkup(createElement(LiveIncident, { state, scenario: failchainScenario, dispatch: () => {} }));
    expect(html).toContain("Incident ongoing");
    expect(html).toContain("Peak impact");
    expect(html).toContain("Auto play");
    expect(html).toContain("Skip to End");
    expect(html).not.toContain("All services restored");
    expect(html).not.toContain("AUTOPILOT");
  });

  it("provides explicit fail/repair controls and a timeline grounded in actual changes", () => {
    const initial = createIncidentState(failchainScenario);
    let state = reduceIncidentState(failchainScenario, initial, { type: "app", action: { type: "fail" } });
    state = reduceIncidentState(failchainScenario, state, { type: "playback-tick", sequence: state.sequence, expectedTick: 1 });
    const timeline = renderToStaticMarkup(createElement(ProductTimeline, { events: state.app.simulation.events, scenario: failchainScenario }));
    expect(timeline).toContain("API Gateway");
    expect(timeline).toContain("offline");
    expect(timeline).toContain("Cause: Identity");
    expect(timeline).toContain("00:02");
    expect(timeline).not.toContain("at risk");
    const inspector = renderToStaticMarkup(createElement(ServiceCard, { scenario: failchainScenario, state: state.app.simulation, selectedId: "identity", onSelect: () => {}, onFail: () => {}, onRepair: () => {} }));
    expect(inspector).toContain("Fail service");
    expect(inspector).toContain(">Repair<");
    expect(inspector).toContain("Manually taken offline");
  });

  it("renders persistent service labels with their actual status and selection", () => {
    const state = reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "app", action: { type: "fail" } });
    const graph = createDisplayGraph(failchainScenario);
    const html = renderToStaticMarkup(createElement(GraphLabels, { graph, state: state.app.simulation, selectedId: "identity", onSelect: () => {}, containerRef: createRef<HTMLDivElement>() }));
    for (const service of failchainScenario.nodes) expect(html).toContain(`<strong>${service.name}</strong>`);
    expect(html).toContain('data-service-id="identity"');
    expect(html).toContain("network-node-label is-selected");
    expect(html).toContain("Offline");
  });

  it("uses stable, owned graph coordinates and readable collision alternatives without changing the scenario", () => {
    const scenario = structuredClone(failchainScenario);
    const original = structuredClone(scenario);
    const graph = createDisplayGraph(scenario);
    expect(createDisplayGraph(scenario)).toEqual(graph);
    expect(new Set(graph.nodes.map((node) => `${node.x}:${node.y}:${node.z}`)).size).toBe(graph.nodes.length);
    expect(graph.nodes.find(({ id }) => id === "identity")!.y).toBeGreaterThan(graph.nodes.find(({ id }) => id === "calendar")!.y!);
    expect(scenario).toEqual(original);
    const labels = placeGraphLabels([{ id: "a", x: 200, y: 150, width: 100, height: 35 }, { id: "b", x: 200, y: 150, width: 100, height: 35 }], 500, 400, "b");
    expect(labels[0]!.id).toBe("b");
    expect(labels[0]!.top).not.toBe(labels[1]!.top);
    expect(labels.every(({ left, top }) => left >= 8 && top >= 40)).toBe(true);
  });
});

