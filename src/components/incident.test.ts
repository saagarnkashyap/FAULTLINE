import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { failchainScenario } from "../scenarios/failchain";
import { createResilienceExperiment } from "../scenarios/resurrection";
import { createIncidentState, reduceIncidentState } from "../incident/incidentState";
import { IncidentPlayback } from "./IncidentPlayback";
import { IncidentOverlay } from "./IncidentOverlay";
import { IncidentAlerts } from "./IncidentAlerts";
import { IncidentSummary } from "./IncidentSummary";

function failure() {
  return reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "app", action: { type: "fail" } });
}

describe("incident presentation", () => {
  it("exposes keyboard controls, automatic/manual choice, and factual empty state", () => {
    const html = renderToStaticMarkup(createElement(IncidentPlayback, { state: createIncidentState(failchainScenario), scenario: failchainScenario, dispatch: () => {} }));
    expect(html).toContain("Play automatically after Fail");
    expect(html).toContain("Pause");
    expect(html).toContain("Resume");
    expect(html).toContain("Skip to End");
    expect(html).toContain("All impact is calculated by the local simulator");
    expect(html).not.toContain("FAULT INJECTED");
    expect(html).toContain("800 ms");
  });

  it("shows a brief nonmodal injection notice and no fabricated dependency cards", () => {
    const state = failure();
    const html = renderToStaticMarkup(createElement(IncidentOverlay, { incident: state.incident }));
    expect(html).toContain("FAULT INJECTED — Identity offline");
    expect(html).toContain("incident-injection");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-modal="true"');
    expect(html).not.toContain("DEPENDENCY IMPACT");
    expect(html).not.toContain("incident-card-injection"); // No duplicate of the initial banner.
    expect(renderToStaticMarkup(createElement(IncidentOverlay, { incident: null }))).toBe("");
  });

  it("bounds visual cards and uses engine transition causes for their text", () => {
    let state = failure();
    state = reduceIncidentState(failchainScenario, state, { type: "playback-tick", sequence: state.sequence, expectedTick: 1 });
    const html = renderToStaticMarkup(createElement(IncidentAlerts, { alerts: state.incident!.alerts }));
    expect((html.match(/<article/g) ?? []).length).toBe(3);
    expect(html).toContain("Cause: Identity");
    expect(html).toContain("CRITICAL CASCADE — 6 services impacted");
    expect(html).not.toContain("SEV-1");
  });

  it("summarizes current impact separately from potential exposure and keeps one polite live region", () => {
    const state = failure();
    const html = renderToStaticMarkup(createElement(IncidentSummary, { state, scenario: failchainScenario }));
    expect(html).toContain("Actual offline</dt><dd>1");
    expect(html).toContain("Actual degraded</dt><dd>0");
    expect(html).toContain("Potential dependency exposure (9) · not confirmed failure");
    expect(html).toContain("Current tick 1");
    expect(html).toContain("elapsed 0 simulation ticks");
    expect(html).toContain("180 / 180");
    expect(html).toContain("Incident ongoing:");
    expect(html).toContain("Yes — nonhealthy services");
    expect((html.match(/aria-live="polite"/g) ?? []).length).toBe(1);
    expect(html).not.toContain('aria-live="assertive"');
  });

  it("does not label a settled outage as resolved, and reports engine-confirmed recovery later", () => {
    let state = reduceIncidentState(failchainScenario, failure(), { type: "skip" });
    let html = renderToStaticMarkup(createElement(IncidentSummary, { state, scenario: failchainScenario }));
    expect(html).toContain("Cascade settled — incident remains ongoing");
    expect(html).toContain("Peak offline + degraded</dt><dd>10");
    expect(html).toContain("Available gateway capacity</dt><dd>0 / 180");
    expect(html).toContain("Required dependency status");
    state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "repair" } });
    html = renderToStaticMarkup(createElement(IncidentSummary, { state, scenario: failchainScenario }));
    expect(html).not.toContain("SERVICE IMPROVED — Identity healthy");
    for (let index = 0; index < 7; index++) state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "step" } });
    html = renderToStaticMarkup(createElement(IncidentSummary, { state, scenario: failchainScenario }));
    expect(html).toContain("All services healthy — no pending incident work");
    expect(html).toContain("SERVICE IMPROVED — Identity healthy");
  });

  it("reports an ongoing incident at the playback cap and omits unavailable traffic metrics", () => {
    const base = createResilienceExperiment();
    const scenario = { ...base.scenario, retry: { ...base.retry, policy: "adaptive" as const, ...base.adaptive } };
    let state = reduceIncidentState(scenario, createIncidentState(scenario), { type: "app", action: { type: "fail" } });
    state = reduceIncidentState(scenario, state, { type: "skip" });
    const html = renderToStaticMarkup(createElement(IncidentSummary, { state, scenario }));
    expect(html).toContain("Playback paused — incident may be ongoing");
    expect(html).toContain("Current tick 19");
    expect(html).toContain("18 simulation ticks");
    const noTraffic = { ...failchainScenario, workload: undefined, routingPool: undefined, retry: undefined };
    const simple = reduceIncidentState(noTraffic, createIncidentState(noTraffic), { type: "app", action: { type: "fail" } });
    const simpleHtml = renderToStaticMarkup(createElement(IncidentSummary, { state: simple, scenario: noTraffic }));
    expect(simpleHtml).not.toContain("Gateway unserved attempts");
    expect(simpleHtml).not.toContain("Available gateway capacity");
  });
});
