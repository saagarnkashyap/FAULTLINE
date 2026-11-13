import { describe, expect, it } from "vitest";
import { enterpriseScenario } from "../scenarios/enterprise";
import { failService, initializeSimulation, repairService, step } from "../simulation/engine";
import { STATUS_PRESENTATION } from "../status";
import { nodeAppearance, nodeTooltip, toGraphData } from "./toGraphData";

describe("graph projection", () => {
  it("copies all services and preserves consumer -> provider direction and dependency kinds", () => {
    const graph = toGraphData(enterpriseScenario);
    expect(graph.nodes.map(({ id, name }) => ({ id, name }))).toEqual(
      enterpriseScenario.nodes.map(({ id, name }) => ({ id, name })),
    );
    expect(graph.links).toEqual(enterpriseScenario.dependencies.map((dependency) => ({
      ...dependency, source: dependency.consumerId, target: dependency.providerId,
    })));
    expect(graph.links).toContainEqual({
      source: "gateway", target: "identity", consumerId: "gateway", providerId: "identity", kind: "required",
    });
  });

  it("allows physics coordinates and rewritten link endpoints without mutating domain inputs", () => {
    const scenario = structuredClone(enterpriseScenario);
    const snapshot = structuredClone(scenario);
    const state = initializeSimulation(scenario);
    const stateCopy = structuredClone(state);
    const graph = toGraphData(scenario);
    const gateway = graph.nodes.find(({ id }) => id === "gateway")!;
    const identity = graph.nodes.find(({ id }) => id === "identity")!;
    gateway.x = 120;
    gateway.y = -40;
    graph.links[0]!.source = gateway;
    graph.links[0]!.target = identity;
    gateway.name = "Renderer-only label";
    expect(scenario).toEqual(snapshot);
    expect(state).toEqual(stateCopy);
    expect(graph.nodes[0]).not.toBe(scenario.nodes[0]);
    expect(graph.links[0]).not.toBe(scenario.dependencies[0]);
  });

  it("maps all four real statuses while retaining renderer identities and layout", () => {
    const graph = toGraphData(enterpriseScenario);
    const nodes = [...graph.nodes];
    const links = [...graph.links];
    graph.nodes[0]!.x = 42;
    let state = initializeSimulation(enterpriseScenario);
    expect(nodeAppearance("identity", state, null).color).toBe(STATUS_PRESENTATION.healthy.color);
    state = failService(enterpriseScenario, state, "email");
    expect(nodeAppearance("email", state, null).color).toBe(STATUS_PRESENTATION.offline.color);
    state = step(enterpriseScenario, state);
    expect(nodeAppearance("calendar", state, null).color).toBe(STATUS_PRESENTATION.degraded.color);
    state = repairService(enterpriseScenario, state, "email");
    expect(nodeAppearance("email", state, null).color).toBe(STATUS_PRESENTATION.recovering.color);
    nodes.forEach((node, index) => expect(graph.nodes[index]).toBe(node));
    links.forEach((link, index) => expect(graph.links[index]).toBe(link));
    expect(graph.nodes[0]!.x).toBe(42);
  });

  it("marks the selected service without replacing its status color", () => {
    const state = failService(enterpriseScenario, initializeSimulation(enterpriseScenario), "identity");
    const selected = nodeAppearance("identity", state, "identity");
    const unselected = nodeAppearance("identity", state, "email");
    expect(selected.selected).toBe(true);
    expect(unselected.selected).toBe(false);
    expect(selected.size).toBeGreaterThan(unselected.size);
    expect(selected.color).toBe(unselected.color);
    expect(selected.color).toBe(STATUS_PRESENTATION.offline.color);
  });

  it("labels hovered nodes with their current status and selection, escaping HTML in names", () => {
    const state = failService(enterpriseScenario, initializeSimulation(enterpriseScenario), "identity");
    const node = { id: "identity", name: 'Identity <primary> & "access"' };
    expect(nodeTooltip(node, state, "identity")).toBe(
      "<strong>Identity &lt;primary&gt; &amp; &quot;access&quot;</strong><br>Offline · Selected",
    );
    expect(nodeTooltip(node, state, null)).not.toContain("Selected");
  });
});
