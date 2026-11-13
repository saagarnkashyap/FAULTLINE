import { describe, expect, it } from "vitest";
import { failchainScenario } from "../scenarios/failchain";
import { initializeSimulation, step } from "../simulation/engine";
import { nodeAppearance, toGraphData } from "./toGraphData";
import { STATUS_PRESENTATION } from "../status";

describe("incident node emphasis", () => {
  it("preserves actual status colors, selected-node priority, and renderer-owned positions", () => {
    const graph = toGraphData(failchainScenario);
    const node = graph.nodes.find(({ id }) => id === "identity")!;
    node.x = 45; node.y = -20; node.z = 11;
    const before = structuredClone(graph);
    const failed = step(failchainScenario, initializeSimulation(failchainScenario), { type: "fail", serviceId: "identity" });
    expect(nodeAppearance("identity", failed, null, ["identity"])).toMatchObject({ color: STATUS_PRESENTATION.offline.color, size: 2 });
    expect(nodeAppearance("identity", failed, "identity", ["identity"])).toMatchObject({ size: 8, selected: true });
    expect(nodeAppearance("calendar", failed, null, ["identity"]).color).toBe(STATUS_PRESENTATION.healthy.color);
    expect(nodeAppearance("identity", failed, null).size).toBe(1);
    expect(graph).toEqual(before);
    expect(graph.nodes.find(({ id }) => id === "identity")).toBe(node);
  });
});
