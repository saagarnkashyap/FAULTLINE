import { describe, expect, it } from "vitest";
import { enterpriseScenario } from "../scenarios/enterprise";
import { withWorkload, WORKLOAD_PRESETS } from "../scenarios/workloads";
import { failService, initializeSimulation, repairService, resetSimulation, step, validateScenario } from "./engine";
import type { SimulationScenario, SimulationState } from "./types";

function scenario(demand = 150): SimulationScenario {
  return {
    id: "traffic-fixture",
    nodes: ["A", "B", "C", "D"].map((id) => ({ id, name: id, description: id, capacityPerTick: 100 })),
    dependencies: [
      { consumerId: "B", providerId: "A", kind: "required" },
      { consumerId: "C", providerId: "A", kind: "optional" },
    ],
    config: { tickDurationMs: 1000, recoveryTicks: 2, maxTicks: 1000 },
    workload: { id: "normal", name: "Fixture", description: "Fixed requests/tick", demandPerTick: { A: demand, B: 60, C: 60, D: 20 } },
  };
}

function advance(topology: SimulationScenario, ticks: number, initial = initializeSimulation(topology)): SimulationState {
  let state = initial;
  for (let i = 0; i < ticks; i += 1) state = step(topology, state);
  return state;
}

function service(state: SimulationState, id = "A") {
  const runtime = state.services[id];
  if (!runtime?.traffic) throw new Error(`Missing traffic for ${id}`);
  return { ...runtime, traffic: runtime.traffic };
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

describe("capacity and admitted demand", () => {
  it("starts at tick zero with configured demand but no evaluated traffic or penalties", () => {
    const initial = initializeSimulation(scenario());
    expect(service(initial)).toEqual({
      local: { kind: "ready" }, status: "healthy",
      traffic: { offeredDemandPerTick: 150, incomingDemandPerTick: 0, availableCapacityPerTick: 100,
        utilizationPercent: 0, consecutiveOverloadedTicks: 0 },
    });
    expect(initial.events).toEqual([]);
  });

  it.each([0, 70, 100])("keeps demand %i within capacity without overload penalties", (demand) => {
    const state = advance(scenario(demand), 6);
    expect(service(state).status).toBe("healthy");
    expect(service(state).traffic).toEqual({ offeredDemandPerTick: demand, incomingDemandPerTick: demand,
      availableCapacityPerTick: 100, utilizationPercent: demand, consecutiveOverloadedTicks: 0 });
    expect(state.events).toEqual([]);
  });

  it("degrades at 150%, then fails locally on exactly the third consecutive overloaded tick", () => {
    const topology = scenario();
    const tick1 = step(topology, initializeSimulation(topology));
    const tick2 = step(topology, tick1);
    const tick3 = step(topology, tick2);
    expect(service(tick1).status).toBe("degraded");
    expect(service(tick1).traffic.utilizationPercent).toBe(150);
    expect(service(tick1).traffic.consecutiveOverloadedTicks).toBe(1);
    expect(service(tick2).status).toBe("degraded");
    expect(service(tick2).traffic.consecutiveOverloadedTicks).toBe(2);
    expect(service(tick3).local).toEqual({ kind: "failed", cause: { type: "overload", tick: 3 } });
    expect(service(tick3).status).toBe("offline");
    // The trip tick retains the measurements that caused it, not a fictitious zero utilization.
    expect(service(tick3).traffic.incomingDemandPerTick).toBe(150);
    expect(service(tick3).traffic.consecutiveOverloadedTicks).toBe(3);
    const tick4 = step(topology, tick3);
    expect(service(tick4).traffic).toEqual({ offeredDemandPerTick: 150, incomingDemandPerTick: 0,
      availableCapacityPerTick: 0, utilizationPercent: 0, consecutiveOverloadedTicks: 0 });
    expect(tick4.events.filter((event) => event.serviceId === "A")).toEqual(
      tick3.events.filter((event) => event.serviceId === "A"),
    );
  });

  it("uses integer demand comparisons and rounds utilization only for display", () => {
    const base = scenario(101);
    const topology = { ...base, nodes: base.nodes.map((node) => ({ ...node, capacityPerTick: 99 })) };
    const state = step(topology, initializeSimulation(topology));
    expect(service(state).traffic.utilizationPercent).toBe(102.02);
    expect(service(state).status).toBe("degraded");
  });

  it("honors an explicit positive overload threshold", () => {
    const base = scenario();
    const topology = { ...base, config: { ...base.config, overloadFailureTicks: 2 } };
    expect(service(advance(topology, 2)).local).toEqual({ kind: "failed", cause: { type: "overload", tick: 2 } });
  });
});

describe("overload, dependencies, and local precedence", () => {
  it("propagates overload health one hop per tick while isolating the independent branch", () => {
    const topology = scenario();
    const tick1 = advance(topology, 1);
    const tick2 = step(topology, tick1);
    const tick3 = step(topology, tick2);
    const tick4 = step(topology, tick3);
    expect(service(tick1, "B").status).toBe("healthy");
    expect(service(tick2, "B").status).toBe("degraded");
    expect(service(tick3, "B").status).toBe("degraded");
    expect(service(tick4, "B").status).toBe("offline");
    expect(service(tick4, "B").local).toEqual({ kind: "ready" });
    expect(service(tick4, "B").traffic.consecutiveOverloadedTicks).toBe(0);
    expect(service(tick4, "C").status).toBe("degraded");
    expect(service(tick4, "C").traffic.incomingDemandPerTick).toBe(60);
    expect(service(tick4, "D").status).toBe("healthy");
    expect(() => repairService(topology, tick4, "B")).toThrow(/locally failed/);
  });

  it("resets a blocked consumer's counter without false overload events; optional loss still admits demand", () => {
    const base = scenario();
    const topology = { ...base, workload: { ...base.workload!, demandPerTick: { A: 150, B: 200, C: 200, D: 20 } } };
    // At tick 1 B/C read the still-healthy previous A snapshot, so they can admit demand.
    const tick1 = failService(topology, initializeSimulation(topology), "A");
    expect(service(tick1, "B").traffic.consecutiveOverloadedTicks).toBe(1);
    const tick2 = step(topology, tick1);
    expect(service(tick2, "B").local).toEqual({ kind: "ready" });
    expect(service(tick2, "B").traffic).toEqual({ offeredDemandPerTick: 200, incomingDemandPerTick: 0,
      availableCapacityPerTick: 0, utilizationPercent: 0, consecutiveOverloadedTicks: 0 });
    const tick6 = advance(topology, 4, tick2);
    expect(tick6.events.filter((event) => event.serviceId === "B" && event.type.startsWith("overload") && event.tick > 1)).toEqual([]);
    expect(service(tick6, "B").status).toBe("offline");
    expect(service(tick2, "C").traffic.consecutiveOverloadedTicks).toBe(2);
    expect(service(tick6, "C").local).toEqual({ kind: "failed", cause: { type: "overload", tick: 3 } });
  });

  it("admits no demand while a required provider is restarting, then starts a fresh streak", () => {
    const base = scenario();
    const topology = { ...base, workload: { ...base.workload!, demandPerTick: { A: 70, B: 200, C: 60, D: 20 } } };
    let state = failService(topology, initializeSimulation(topology), "A");
    state = repairService(topology, state, "A"); // A ready at tick 4.
    state = step(topology, state); // Tick 3: A recovering, B blocked.
    expect(service(state, "B").traffic.incomingDemandPerTick).toBe(0);
    expect(service(state, "B").traffic.consecutiveOverloadedTicks).toBe(0);
    state = step(topology, state); // Tick 4: B still reads A recovering.
    expect(service(state, "B").traffic.incomingDemandPerTick).toBe(0);
    state = step(topology, state);
    expect(service(state, "B").status).toBe("degraded");
    expect(service(state, "B").traffic.consecutiveOverloadedTicks).toBe(1);
  });

  it("lets a manual fail command override an overload that would otherwise trip that tick", () => {
    const topology = scenario();
    const tick2 = advance(topology, 2);
    const failed = failService(topology, tick2, "A");
    expect(service(failed).local).toEqual({ kind: "failed" });
    expect(service(failed).traffic.incomingDemandPerTick).toBe(0);
    expect(service(failed).traffic.consecutiveOverloadedTicks).toBe(0);
    expect(failed.events.some((event) => event.type === "overload-failed" && event.serviceId === "A")).toBe(false);
    const later = advance(topology, 5, failed);
    expect(later.events.filter((event) => event.serviceId === "A")).toEqual(failed.events.filter((event) => event.serviceId === "A"));
  });
});

describe("overload repair, reset, chronology, and immutability", () => {
  it("latches overload failures, repairs with the existing delay, and can overload again", () => {
    const topology = scenario();
    const failed = advance(topology, 3);
    expect(service(advance(topology, 2, failed)).local).toEqual(service(failed).local);
    let state = repairService(topology, failed, "A"); // Repair at 4, ready at 6.
    expect(service(state).local).toEqual({ kind: "recovering", readyAtTick: 6 });
    expect(service(state).traffic.consecutiveOverloadedTicks).toBe(0);
    expect(service(state).traffic.availableCapacityPerTick).toBe(0);
    state = step(topology, state);
    expect(service(state).status).toBe("recovering");
    state = step(topology, state);
    expect(service(state).local).toEqual({ kind: "ready" });
    expect(service(state).status).toBe("degraded");
    expect(service(state).traffic.consecutiveOverloadedTicks).toBe(1);
    state = advance(topology, 2, state);
    expect(service(state).local).toEqual({ kind: "failed", cause: { type: "overload", tick: 8 } });
  });

  it("clears all overload counters, failure causes, and logs on reset", () => {
    const topology = scenario();
    const failed = advance(topology, 3);
    const copy = structuredClone(failed);
    const reset = resetSimulation(topology);
    expect(reset).toEqual(initializeSimulation(topology));
    expect(reset.events).toEqual([]);
    expect(service(reset).local).toEqual({ kind: "ready" });
    expect(service(reset).traffic.consecutiveOverloadedTicks).toBe(0);
    expect(failed).toEqual(copy);
  });

  it("does not overload a repaired consumer while its required provider remains offline", () => {
    const base = scenario();
    const topology = { ...base, workload: { ...base.workload!, demandPerTick: { A: 150, B: 200, C: 60, D: 20 } } };
    const failed = advance(topology, 3);
    expect(service(failed, "B").local).toEqual({ kind: "failed", cause: { type: "overload", tick: 3 } });
    const restarting = repairService(topology, failed, "B");
    const blocked = advance(topology, 5, restarting);
    expect(service(blocked, "B").local).toEqual({ kind: "ready" });
    expect(service(blocked, "B").status).toBe("offline");
    expect(service(blocked, "B").traffic.incomingDemandPerTick).toBe(0);
    expect(service(blocked, "B").traffic.consecutiveOverloadedTicks).toBe(0);
    expect(blocked.events.filter((event) => event.serviceId === "B" && event.type.startsWith("overload") && event.tick > 3)).toEqual([]);
  });

  it("orders commands first, then per-service overload events before status changes", () => {
    const base = scenario();
    const topology = { ...base, dependencies: [], workload: { ...base.workload!, demandPerTick: { A: 150, B: 150, C: 60, D: 20 } } };
    const state = failService(topology, initializeSimulation(topology), "D");
    expect(state.events.map((event) => [event.type, event.serviceId])).toEqual([
      ["command-applied", "D"], ["overload-started", "A"], ["status-changed", "A"],
      ["overload-started", "B"], ["status-changed", "B"], ["status-changed", "D"],
    ]);
    const failed = advance(topology, 2, state);
    expect(failed.events.filter(({ tick }) => tick === 3).map((event) => [event.type, event.serviceId])).toEqual([
      ["overload-failed", "A"], ["status-changed", "A"], ["overload-failed", "B"], ["status-changed", "B"],
    ]);
  });

  it("does not mutate frozen snapshots, commands, topology, or preset data", () => {
    const topology = freezeDeep(structuredClone(scenario()));
    const original = structuredClone(topology);
    let state = freezeDeep(initializeSimulation(topology));
    for (let i = 0; i < 4; i += 1) {
      const copy = structuredClone(state);
      const next = freezeDeep(step(topology, state));
      expect(state).toEqual(copy);
      state = next;
    }
    const command = freezeDeep({ type: "repair" as const, serviceId: "A" });
    step(topology, state, command);
    expect(topology).toEqual(original);
    expect(command).toEqual({ type: "repair", serviceId: "A" });
  });

  it("still stops at maxTicks without changing counters or events", () => {
    const base = scenario();
    const topology = { ...base, config: { ...base.config, maxTicks: 2 } };
    const final = advance(topology, 2);
    expect(step(topology, final)).toBe(final);
    expect(service(final).traffic.consecutiveOverloadedTicks).toBe(2);
  });
});

describe("reproducible workload presets and traffic validation", () => {
  it.each(["normal", "high", "spike"] as const)("replays %s identically, independent of topology or demand key order", (id) => {
    const topology = withWorkload(enterpriseScenario, id);
    const reordered = { ...topology, nodes: [...topology.nodes].reverse(), dependencies: [...topology.dependencies].reverse(),
      workload: { ...topology.workload!, demandPerTick: Object.fromEntries(Object.entries(topology.workload!.demandPerTick).reverse()) } };
    expect(advance(topology, 8)).toEqual(advance(topology, 8));
    expect(advance(reordered, 8)).toEqual(advance(topology, 8));
    expect(resetSimulation(topology)).toEqual(initializeSimulation(withWorkload(enterpriseScenario, id)));
    expect(topology.nodes).toBe(enterpriseScenario.nodes);
    expect(topology.dependencies).toBe(enterpriseScenario.dependencies);
  });

  it("keeps Normal healthy, overloads Gateway in High, and trips exactly three selected services in Spike", () => {
    const normal = advance(withWorkload(enterpriseScenario, "normal"), 8);
    expect(Object.values(normal.services).every(({ status }) => status === "healthy")).toBe(true);
    const high = advance(withWorkload(enterpriseScenario, "high"), 3);
    expect(high.services.gateway?.local).toEqual({ kind: "failed", cause: { type: "overload", tick: 3 } });
    const spike = advance(withWorkload(enterpriseScenario, "spike"), 3);
    expect(spike.events.filter(({ type }) => type === "overload-failed").map(({ serviceId }) => serviceId)).toEqual(["assistant", "email", "gateway"]);
    expect(spike.services.billing?.status).toBe("healthy");
    expect(WORKLOAD_PRESETS.spike.demandPerTick.gateway).toBe(360);
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid demand %s", (demand) => {
    expect(() => validateScenario(scenario(demand))).toThrow(/nonnegative safe integer/);
  });

  it.each([0, -1, 1.5, NaN, Infinity])("rejects invalid capacity %s", (capacityPerTick) => {
    const base = scenario();
    expect(() => validateScenario({ ...base, nodes: base.nodes.map((node) => ({ ...node, capacityPerTick })) })).toThrow(/Capacity/);
  });

  it("rejects missing capacity, missing demand, unknown demand IDs, and invalid thresholds", () => {
    const base = scenario();
    expect(() => validateScenario({ ...base, nodes: base.nodes.map((node) => ({ ...node, capacityPerTick: undefined })) })).toThrow(/Missing capacity/);
    expect(() => validateScenario({ ...base, workload: { ...base.workload!, demandPerTick: { A: 100 } } })).toThrow(/Demand/);
    expect(() => validateScenario({ ...base, workload: { ...base.workload!, demandPerTick: { ...base.workload!.demandPerTick, missing: 10 } } })).toThrow(/Unknown workload/);
    expect(() => validateScenario({ ...base, config: { ...base.config, overloadFailureTicks: 0 } })).toThrow(/positive safe integer/);
  });
});
