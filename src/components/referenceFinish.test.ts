import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ServiceIcon } from "./ServiceIcon";
import { ServiceCard } from "./ServiceCard";
import { GraphLabels } from "../graph/GraphLabels";
import { createDisplayGraph } from "../graph/displayLayout";
import { linkAppearance } from "../graph/toGraphData";
import { failchainScenario } from "../scenarios/failchain";
import { initializeSimulation, step } from "../simulation/engine";
import { STATUS_PRESENTATION } from "../status";
import { UI_COLORS } from "../theme";
import { ProductTimeline } from "./ProductTimeline";
import App from "../App";

describe("reference-inspired presentation finish", () => {
  it("puts the timeline directly after the main panels and keeps secondary controls collapsed", () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html.indexOf('class="panel services-panel"')).toBeLessThan(html.indexOf('id="network-heading"'));
    expect(html.indexOf('id="network-heading"')).toBeLessThan(html.indexOf('id="inspector-heading"'));
    expect(html.indexOf('id="inspector-heading"')).toBeLessThan(html.indexOf('id="timeline-heading"'));
    expect(html.indexOf('id="timeline-heading"')).toBeLessThan(html.indexOf('class="incident-details"'));
    expect(html).toContain('<details class="incident-details"><summary>');
    expect(html).not.toContain('class="network-stats"');
    expect(html).toContain('aria-label="Live service totals"');
    expect(html).not.toContain("AUTOPILOT");
  });

  it("uses local accessible service symbols consistently without replacing readable names", () => {
    const state = initializeSimulation(failchainScenario);
    for (const { id } of failchainScenario.nodes) {
      const icon = renderToStaticMarkup(createElement(ServiceIcon, { serviceId: id }));
      expect(icon).toContain(`data-service-icon="${id}"`);
      expect(icon).toContain('aria-hidden="true"');
      expect(icon).toContain('viewBox="0 0 24 24"');
    }
    const graph = createDisplayGraph(failchainScenario);
    const labels = renderToStaticMarkup(createElement(GraphLabels, { graph, state, selectedId: "documents", onSelect: () => {}, containerRef: createRef<HTMLDivElement>() }));
    expect(labels).toContain('data-service-icon="documents"');
    expect(labels).toContain("<strong>Document Storage</strong>");
    const inspector = renderToStaticMarkup(createElement(ServiceCard, { scenario: failchainScenario, state, selectedId: "documents", onSelect: () => {}, onFail: () => {}, onRepair: () => {} }));
    expect(inspector).toContain('data-service-icon="documents"');
    expect(inspector).toContain("Document Storage");
    expect(inspector).toContain("Healthy");
  });

  it("colors connections from current provider status without preempting one-step propagation", () => {
    let state = step(failchainScenario, initializeSimulation(failchainScenario), { type: "fail", serviceId: "identity" });
    const failedProvider = { source: "gateway", target: "identity", consumerId: "gateway", providerId: "identity", kind: "required" as const };
    const downstream = { source: "calendar", target: "gateway", consumerId: "calendar", providerId: "gateway", kind: "required" as const };
    const copy = structuredClone(state);
    expect(linkAppearance(failedProvider, state, null).color).toBe(STATUS_PRESENTATION.offline.color);
    expect(linkAppearance(downstream, state, null).color).toBe(UI_COLORS["link-required"]);
    expect(linkAppearance(downstream, state, "calendar")).toEqual({ color: UI_COLORS.text, width: 1.8 });
    expect(state).toEqual(copy);
    state = step(failchainScenario, state);
    expect(linkAppearance(downstream, state, null).color).toBe(STATUS_PRESENTATION.offline.color);
    expect(state.services.calendar!.status).toBe("healthy");
  });

  it("retains real chronological events and provider causes in the compact timeline", () => {
    let state = step(failchainScenario, initializeSimulation(failchainScenario), { type: "fail", serviceId: "identity" });
    state = step(failchainScenario, state);
    const html = renderToStaticMarkup(createElement(ProductTimeline, { events: state.events, scenario: failchainScenario }));
    expect(html.indexOf("00:01")).toBeLessThan(html.indexOf("00:02"));
    expect(html).toContain("Cause: Identity");
    expect(html).toContain("timeline-status-offline");
    expect(html).not.toContain("At Risk");
    expect(html).not.toContain("12%");
  });
});
