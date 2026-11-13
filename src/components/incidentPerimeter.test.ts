import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { failchainScenario } from "../scenarios/failchain";
import { createIncidentState, reduceIncidentState } from "../incident/incidentState";
import { IncidentCommandOverlay, incidentPerimeterCards } from "./IncidentCommandOverlay";

describe("compact perimeter warnings", () => {
  it("keeps every offline service in its own small box around all four graph edges", () => {
    let state = reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "app", action: { type: "select", serviceId: "gateway" } });
    state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "fail" } });
    state = reduceIncidentState(failchainScenario, state, { type: "skip" });
    expect(state.incident!.phase).toBe("ended");
    const cards = incidentPerimeterCards(state);
    expect(cards).toHaveLength(5);
    expect(cards.every(({ status, predicted }) => status === "offline" && !predicted)).toBe(true);
    for (const id of ["gateway", "assistant", "calendar", "crm", "support"]) expect(cards.some(({ serviceId }) => serviceId === id)).toBe(true);
    const html = renderToStaticMarkup(createElement(IncidentCommandOverlay, { state, scenario: failchainScenario }));
    expect((html.match(/role="listitem"/g) ?? []).length).toBe(5);
    for (const edge of ["top", "right", "bottom", "left"]) expect(html).toContain(`edge-${edge}`);
    expect(html).toContain("is-expanded");
    expect(html).not.toContain('class="command-warning');
    expect(html).not.toContain("confirmed-services");
  });

  it("keeps confirmed status separate from predicted risks without duplicating service boxes", () => {
    const state = reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "app", action: { type: "fail" } });
    const copy = structuredClone(state);
    const cards = incidentPerimeterCards(state);
    expect(new Set(cards.map(({ serviceId }) => serviceId)).size).toBe(cards.length);
    expect(cards[0]).toMatchObject({ serviceId: "identity", detail: "OFFLINE", predicted: false });
    expect(cards.some(({ predicted, detail }) => predicted && detail === "May go down in ~2 seconds")).toBe(true);
    expect(cards.some(({ predicted, detail }) => predicted && detail === "May go down in ~4 seconds")).toBe(true);
    const html = renderToStaticMarkup(createElement(IncidentCommandOverlay, { state, scenario: failchainScenario }));
    expect(html).toContain("mini-offline");
    expect(html).toContain("mini-risk");
    expect(html).toContain('aria-label="Minimize warnings"');
    expect(state).toEqual(copy);
  });

  it("supports all affected services without overflowing the available perimeter slots", () => {
    let state = reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "app", action: { type: "fail" } });
    state = reduceIncidentState(failchainScenario, state, { type: "skip" });
    const cards = incidentPerimeterCards(state);
    expect(cards).toHaveLength(10);
    const html = renderToStaticMarkup(createElement(IncidentCommandOverlay, { state, scenario: failchainScenario }));
    const positions = [...html.matchAll(/grid-row:(\d+);grid-column:(\d+)/g)].map((match) => `${match[1]}:${match[2]}`);
    expect(positions).toHaveLength(10);
    expect(new Set(positions).size).toBe(10);
    expect(positions.every((position) => position.startsWith("1:") || position.startsWith("5:") || position.endsWith(":1") || position.endsWith(":4"))).toBe(true);
  });
});

