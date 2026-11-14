import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createAppState, reduceAppState } from "../appState";
import { failchainScenario } from "../scenarios/failchain";
import { createResilienceExperiment } from "../scenarios/resurrection";
import { compareRecoveryStrategies } from "../simulation/experiments";
import { createIncidentState, reduceIncidentState } from "../incident/incidentState";
import { STATUS_PRESENTATION } from "../status";
import { THEME_STYLE, UI_COLORS } from "../theme";
import { fitNetwork, resetNetworkCamera } from "../graph/graphView";
import { PerspectiveCamera, Vector3 } from "three";
import { createDisplayGraph } from "../graph/displayLayout";
import { linkTooltip } from "../graph/toGraphData";
import { incidentNoticeTone } from "./incidentPresentation";
import { IncidentAlerts } from "./IncidentAlerts";
import { IncidentOverlay } from "./IncidentOverlay";
import { RecoveryResults } from "./RecoveryComparison";
import { ServiceDetails } from "./ServiceDetails";
import { AutopilotStatus } from "./AutopilotPanel";

const noop = () => {};

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)!.map((part) => {
    const channel = parseInt(part, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
}

describe("Phase 5B presentation", () => {
  it("shares semantic CSS/WebGL colors and keeps normal text contrast above 4.5:1 on all primary surfaces", () => {
    for (const status of ["healthy", "degraded", "offline", "recovering"] as const) expect(STATUS_PRESENTATION[status].color).toBe(UI_COLORS[status]);
    expect(THEME_STYLE).toMatchObject({ "--surface": UI_COLORS.surface, "--interaction": UI_COLORS.interaction });
    for (const background of [UI_COLORS.bg, UI_COLORS.surface, UI_COLORS.elevated, UI_COLORS.graph]) {
      for (const foreground of [UI_COLORS.text, UI_COLORS.secondary, UI_COLORS.muted, UI_COLORS.interaction, UI_COLORS.healthy, UI_COLORS.degraded, UI_COLORS.offline, UI_COLORS.recovering]) {
        expect((luminance(foreground) + .05) / (luminance(background) + .05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("fits module bounds and changes only the camera on an explicit request", () => {
    const camera = new PerspectiveCamera(50, 1, .1, 10000); camera.position.set(0, 0, 600);
    const graph = { camera: () => camera, controls: () => ({ target: new Vector3() }), cameraPosition: vi.fn() };
    const nodes = createDisplayGraph(failchainScenario).nodes;
    const before = structuredClone(nodes);
    expect(fitNetwork(graph, 700, 500, nodes)).toBe(true);
    expect(graph.cameraPosition.mock.calls[0]![2]).toBe(500);
    expect(resetNetworkCamera(graph, 700, 500, nodes)).toBe(true);
    expect(nodes).toEqual(before);
    expect(resetNetworkCamera(undefined, 700, 500, nodes)).toBe(false);
    expect(resetNetworkCamera(graph, 0, 500, nodes)).toBe(false);
    expect(graph.cameraPosition).toHaveBeenCalledTimes(2);
  });

  it("explains link direction and membership while escaping scenario names in HTML tooltips", () => {
    const scenario = { ...failchainScenario, nodes: failchainScenario.nodes.map((node) => node.id === "calendar" ? { ...node, name: '<Calendar & "events">' } : node) };
    const link = { source: "calendar", target: "gateway", consumerId: "calendar", providerId: "gateway", kind: "required" as const };
    const label = linkTooltip(link, scenario);
    expect(label).toContain("&lt;Calendar &amp; &quot;events&quot;&gt; → API Gateway");
    expect(label).toContain("consumer depends on provider");
    expect(linkTooltip({ ...link, kind: "pool-member" }, scenario)).toContain("either backend can serve");
  });

  it("colors partial recovery amber and actual healthy transitions green, never assuming a restart is healthy", () => {
    let state = reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "app", action: { type: "fail" } });
    state = reduceIncidentState(failchainScenario, state, { type: "skip" });
    state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "repair" } });
    expect(state.incident!.alerts.some((alert) => alert.level === "recovery")).toBe(false);
    for (let index = 0; index < 7; index++) state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "step" } });
    const healthy = state.incident!.alerts.find((alert) => alert.level === "recovery" && alert.serviceId === "identity")!;
    expect(incidentNoticeTone(healthy, state.app.simulation.events)).toBe("healthy");
    const partial = { ...healthy, serviceId: "gateway", tick: 500, title: "SERVICE IMPROVED — API Gateway degraded" };
    const actual = { type: "status-changed" as const, tick: 500, serviceId: "gateway", from: "offline" as const, to: "degraded" as const, providerIds: [] };
    expect(incidentNoticeTone(partial, [actual])).toBe("degraded");
    expect(incidentNoticeTone(partial)).toBe("improved");
    const html = renderToStaticMarkup(createElement(IncidentAlerts, { alerts: [partial], events: [actual] }));
    expect(html).toContain("notice-degraded");
    expect(html).not.toContain("notice-healthy");
  });

  it("provides explicit notice dismissal without dropping historical incident entries", () => {
    let state = reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "app", action: { type: "fail" } });
    state = reduceIncidentState(failchainScenario, state, { type: "skip" });
    const copy = structuredClone(state);
    const html = renderToStaticMarkup(createElement(IncidentOverlay, { incident: state.incident, events: state.app.simulation.events }));
    expect(html).toContain('aria-label="Dismiss visible notices"');
    expect(html).toContain("all retained notices remain in the incident timeline");
    expect(state).toEqual(copy);
  });

  it("shows controller Monitoring, Waiting and Repair selected states using existing decisions", () => {
    let app = reduceAppState(failchainScenario, createAppState(failchainScenario), { type: "autopilot", enabled: true });
    function html() { return renderToStaticMarkup(createElement(AutopilotStatus, { state: app, scenario: failchainScenario, onToggle: noop, onCooldown: noop })); }
    expect(html()).toContain("Monitoring");
    app = reduceAppState(failchainScenario, app, { type: "select", serviceId: "gateway-a" });
    app = reduceAppState(failchainScenario, app, { type: "fail" });
    expect(html()).toContain("Waiting");
    app = reduceAppState(failchainScenario, app, { type: "step" });
    app = reduceAppState(failchainScenario, app, { type: "step" });
    expect(html()).toContain("Repair selected");
    expect(app.simulation.services["gateway-a"]!.local.kind).toBe("failed"); // Selected is not executed.
  });

  it("puts fault controls before long metric lists and explains actual selected-member controller history", () => {
    let app = createAppState(failchainScenario);
    app = reduceAppState(failchainScenario, app, { type: "select", serviceId: "gateway-a" });
    app = reduceAppState(failchainScenario, app, { type: "fail" });
    const html = renderToStaticMarkup(createElement(ServiceDetails, { scenario: failchainScenario, state: app.simulation,
      selectedId: app.selectedId, onSelect: noop, onFail: noop, onRepair: noop, autopilot: app }));
    expect(html.indexOf("Fault controls")).toBeLessThan(html.indexOf("Service capacity"));
    expect(html).toContain("Gateway Instance A");
    expect(html).toContain("1 local failures observed");
    expect(html).toContain("Failure cooldown permits repair from tick 4");
    expect(html).toContain("Failed · manual injection");
  });

  it("marks metric differences without altering calculated comparison values or declaring a winner", () => {
    const comparison = compareRecoveryStrategies(createResilienceExperiment());
    const before = structuredClone(comparison);
    const html = renderToStaticMarkup(createElement(RecoveryResults, { comparison }));
    expect(html).toContain("metric-varies");
    expect(html).toContain("Different</span>");
    expect(html).toContain("No overall winning strategy is assumed");
    expect(html).toContain("Tick 29");
    expect(html).toContain("Tick 32");
    expect(html).toContain("1,422");
    expect(comparison).toEqual(before);
  });
});
