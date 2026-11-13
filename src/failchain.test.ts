import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "./App";
import { createAppState, reduceAppState } from "./appState";
import { EventLog } from "./components/EventLog";
import { ServiceDetails } from "./components/ServiceDetails";
import { toGraphData } from "./graph/toGraphData";
import { enterpriseScenario } from "./scenarios/enterprise";
import { failchainScenario as scenario } from "./scenarios/failchain";
import { withWorkload } from "./scenarios/workloads";
import { failService, initializeSimulation, step } from "./simulation/engine";

const noop = () => {};

describe("FAILCHAIN scenario and application integration", () => {
  it("extends the enterprise without replacing consumer references or mutating the Phase 2A scenario", () => {
    expect(enterpriseScenario.nodes).toHaveLength(10);
    expect(scenario.nodes).toHaveLength(12);
    expect(scenario.routingPool?.memberIds).toEqual(["gateway-a", "gateway-b"]);
    expect(scenario.dependencies).toEqual(expect.arrayContaining([...enterpriseScenario.dependencies]));
    expect(scenario.dependencies.filter(({ providerId }) => providerId === "gateway").map(({ consumerId }) => consumerId).sort()).toEqual(["assistant", "calendar", "crm"]);
    expect(scenario.workload?.demandPerTick.gateway).toBe(0);
    expect(scenario.workload?.demandPerTick["gateway-a"]).toBe(0);
    expect(scenario.workload?.demandPerTick["gateway-b"]).toBe(0);
  });

  it("projects pool membership separately from required dependencies and retains layout objects during application actions", () => {
    const graph = toGraphData(scenario);
    expect(graph.links.filter(({ kind }) => kind === "pool-member")).toEqual([
      { source: "gateway", target: "gateway-a", consumerId: "gateway", providerId: "gateway-a", kind: "pool-member" },
      { source: "gateway", target: "gateway-b", consumerId: "gateway", providerId: "gateway-b", kind: "pool-member" },
    ]);
    const node = graph.nodes[0]!;
    const link = graph.links[0]!;
    node.x = 42;
    let app = reduceAppState(scenario, createAppState(scenario), { type: "select", serviceId: "gateway-a" });
    app = reduceAppState(scenario, app, { type: "fail" });
    app = reduceAppState(scenario, app, { type: "step" });
    expect(app.simulation.services["gateway-b"]?.traffic?.consecutiveOverloadedTicks).toBe(2);
    expect(graph.nodes[0]).toBe(node);
    expect(graph.links[0]).toBe(link);
    expect(node.x).toBe(42);
    expect(withWorkload(scenario, "high").nodes).toBe(scenario.nodes);
    expect(withWorkload(scenario, "high").dependencies).toBe(scenario.dependencies);
  });

  it("runs fail, cascade, repair, and reset through the existing application controls", () => {
    const initial = createAppState(scenario);
    let app = reduceAppState(scenario, initial, { type: "select", serviceId: "gateway-a" });
    app = reduceAppState(scenario, app, { type: "fail" });
    expect(app.simulation.routingPool?.members["gateway-b"]?.assignedRequestsPerTick).toBe(120);
    app = reduceAppState(scenario, app, { type: "step" });
    app = reduceAppState(scenario, app, { type: "step" });
    expect(app.simulation.services.gateway?.status).toBe("offline");
    expect(app.simulation.services["gateway-b"]?.local).toEqual({ kind: "failed", cause: { type: "overload", tick: 3 } });
    app = reduceAppState(scenario, app, { type: "repair" });
    expect(app.simulation.services["gateway-a"]?.local).toEqual({ kind: "recovering", readyAtTick: 6 });
    app = reduceAppState(scenario, app, { type: "step" });
    app = reduceAppState(scenario, app, { type: "step" });
    expect(app.simulation.services["gateway-a"]?.local.kind).toBe("ready");
    expect(app.simulation.routingPool?.status).toBe("degraded");
    app = reduceAppState(scenario, app, { type: "reset" });
    expect(app.simulation).toEqual(initial.simulation);
    expect(app.selectedId).toBe("gateway-a");
    expect(app.error).toBeNull();
  });

  it("resets workload changes and uses the same pool demand in actions and rendering", () => {
    let app = reduceAppState(scenario, createAppState(scenario), { type: "step" });
    app = reduceAppState(scenario, app, { type: "workload", workloadId: "high" });
    expect(app.simulation.tick).toBe(0);
    expect(app.simulation.routingPool?.assignedRequestsPerTick).toBe(0);
    expect(app.simulation.events).toEqual([]);
    app = reduceAppState(scenario, app, { type: "step" });
    expect(app.simulation.routingPool?.incomingDemandPerTick).toBe(180);
    expect(app.simulation.routingPool?.members["gateway-a"]?.assignedRequestsPerTick).toBe(90);
    expect(app.simulation).toEqual(step(withWorkload(scenario, "high"), initializeSimulation(withWorkload(scenario, "high"))));
    app = reduceAppState(scenario, app, { type: "reset" });
    expect(app.workloadId).toBe("high");
    expect(app.simulation.services.gateway?.traffic?.offeredDemandPerTick).toBe(180);
  });

  it("shows a concise scenario explanation and all services in the existing interface", () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain("FAILCHAIN · Gateway failover");
    expect(html).toContain("Gateway Instance A");
    expect(html).toContain("Gateway Instance B");
    expect(html).toContain("Pool membership · either backend can serve");
    expect(html).toContain("resets experiment");
  });

  it("shows pool membership, shortage, throughput, and the real local overload failure", () => {
    const tick1 = failService(scenario, initializeSimulation(scenario), "gateway-a");
    const gatewayHtml = renderToStaticMarkup(createElement(ServiceDetails, {
      scenario, state: tick1, selectedId: "gateway", onSelect: noop, onFail: noop, onRepair: noop,
    }));
    expect(gatewayHtml).toContain("gateway-backends");
    expect(gatewayHtml).toContain("Pool throughput");
    expect(gatewayHtml).toContain("Pool unserved");
    expect(gatewayHtml).toContain("90 / tick");
    expect(gatewayHtml).toContain("30 / tick");
    expect(gatewayHtml).toContain("Per backend instance");
    expect(gatewayHtml).toContain("Run totals per tick");
    const tick3 = step(scenario, step(scenario, tick1));
    const backendHtml = renderToStaticMarkup(createElement(ServiceDetails, {
      scenario, state: tick3, selectedId: "gateway-b", onSelect: noop, onFail: noop, onRepair: noop,
    }));
    expect(backendHtml).toContain("Failed · overload at tick 3");
    expect(backendHtml).toContain("133.33%");
    expect(backendHtml).toContain("Processed requests");
    expect(backendHtml).toContain("0 / tick");
  });

  it("renders only factual routing, overload, pool, and dependency events in engine order", () => {
    const tick1 = failService(scenario, initializeSimulation(scenario), "gateway-a");
    const state = step(scenario, step(scenario, tick1));
    const html = renderToStaticMarkup(createElement(EventLog, { scenario, events: state.events }));
    expect(html).toContain("Traffic redistributed");
    expect(html).toContain("Pool status changed");
    expect(html).toContain("Overload failure");
    expect(html).toContain("Gateway Instance B: 120");
    expect(html).toContain("120 unserved / tick");
    expect((html.match(/<tr>/g) ?? []).length).toBe(state.events.length + 1);
    expect(html.indexOf("Command applied")).toBeLessThan(html.indexOf("Traffic redistributed"));
  });
});
