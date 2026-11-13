import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphUnavailable } from "../graph/ServiceGraph";
import { enterpriseScenario as scenario } from "../scenarios/enterprise";
import { withWorkload } from "../scenarios/workloads";
import { failService, initializeSimulation, step } from "../simulation/engine";
import { Controls } from "./Controls";
import { EventLog } from "./EventLog";
import { ServiceDetails } from "./ServiceDetails";

const noop = () => {};

describe("service inspector and engine event presentation", () => {
  it("shows the selected service's real providers and consumers", () => {
    const html = renderToStaticMarkup(createElement(ServiceDetails, {
      scenario, state: initializeSimulation(scenario), selectedId: "calendar",
      onSelect: noop, onFail: noop, onRepair: noop,
    }));
    expect(html).toContain("Calendar");
    expect(html).toContain("Meetings and scheduling");
    expect(html).toMatch(/Required providers[\s\S]*API Gateway/);
    expect(html).toMatch(/Optional providers[\s\S]*Email/);
    expect(html).toContain("No direct dependents.");
    expect(html).toContain("Ready");
  });

  it("keeps a readable empty selection state", () => {
    const html = renderToStaticMarkup(createElement(ServiceDetails, {
      scenario, state: initializeSimulation(scenario), selectedId: null,
      onSelect: noop, onFail: noop, onRepair: noop,
    }));
    expect(html).toContain("No service selected");
  });

  it("disables local repair for a dependency-only failure and explains the cause", () => {
    const state = step(scenario, failService(scenario, initializeSimulation(scenario), "identity"));
    const html = renderToStaticMarkup(createElement(Controls, {
      runtime: state.services.gateway!, atLimit: false, onFail: noop, onRepair: noop,
    }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Repair service/);
    expect(html).toContain("Restore its providers");
  });

  it("renders engine event order, transitions, names, and direct causes without inventing events", () => {
    const state = step(scenario, failService(scenario, initializeSimulation(scenario), "identity"));
    const html = renderToStaticMarkup(createElement(EventLog, { events: state.events, scenario }));
    expect((html.match(/<tr>/g) ?? []).length).toBe(state.events.length + 1);
    expect(html.indexOf("Command applied")).toBeLessThan(html.indexOf("Status changed"));
    expect(html).toContain("Healthy");
    expect(html).toContain("Offline");
    expect(html).toContain("Cause: Identity");
    expect(html).toContain("0002");
    expect(html).not.toContain("No incidents recorded");
  });

  it("shows an empty log at initialization/reset", () => {
    const html = renderToStaticMarkup(createElement(EventLog, { events: [], scenario }));
    expect(html).toContain("No incidents recorded");
    expect(html).not.toContain("<table");
  });

  it("explains the WebGL fallback and keeps list-based operation discoverable", () => {
    const html = renderToStaticMarkup(createElement(GraphUnavailable));
    expect(html).toContain("3D view unavailable");
    expect(html).toContain("Select a service from the list");
    expect(html).toContain("Failure, repair, stepping, and the incident log remain available");
  });

  it("shows evaluated capacity/demand metrics and distinguishes overload from manual failure", () => {
    const spike = withWorkload(scenario, "spike");
    let state = initializeSimulation(spike);
    for (let i = 0; i < 3; i += 1) state = step(spike, state);
    const html = renderToStaticMarkup(createElement(ServiceDetails, {
      scenario: spike, state, selectedId: "gateway", onSelect: noop, onFail: noop, onRepair: noop,
    }));
    expect(html).toContain("Failed · overload at tick 3");
    expect(html).toContain("240 requests/tick");
    expect(html).toContain("360 requests/tick");
    expect(html).toContain("150%");
    expect(html).toContain("3 / 3");
    expect(html).toContain("Sustained demand can cause another failure");
    const manual = renderToStaticMarkup(createElement(ServiceDetails, {
      scenario, state: failService(scenario, initializeSimulation(scenario), "gateway"),
      selectedId: "gateway", onSelect: noop, onFail: noop, onRepair: noop,
    }));
    expect(manual).toContain("Failed · manual injection");
    expect(manual).not.toContain("Failed · overload");
  });

  it("renders the engine's overload events and their demand/capacity measurements", () => {
    const spike = withWorkload(scenario, "spike");
    let state = initializeSimulation(spike);
    for (let i = 0; i < 3; i += 1) state = step(spike, state);
    const html = renderToStaticMarkup(createElement(EventLog, { scenario: spike, events: state.events }));
    expect(html).toContain("Overload started");
    expect(html).toContain("Overload failure");
    expect(html).toContain("360 requests/tick / 240 capacity");
    expect(html).toContain("150% utilization");
    expect((html.match(/<tr>/g) ?? []).length).toBe(state.events.length + 1);
  });
});
