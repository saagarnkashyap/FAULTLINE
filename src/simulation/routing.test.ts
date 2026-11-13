import { describe, expect, it } from "vitest";
import { failchainScenario } from "../scenarios/failchain";
import { withWorkload } from "../scenarios/workloads";
import { failService, initializeSimulation, repairService, resetSimulation, step, validateScenario } from "./engine";
import type { SimulationScenario, SimulationState } from "./types";

function scenario(demandPerTick = 120): SimulationScenario {
  return {
    id: "gateway-failchain",
    nodes: [
      { id: "gateway", name: "Gateway", description: "Logical gateway", capacityPerTick: 180 },
      { id: "a", name: "A", description: "Backend A", capacityPerTick: 90 },
      { id: "b", name: "B", description: "Backend B", capacityPerTick: 90 },
      { id: "consumer", name: "Consumer", description: "Downstream", capacityPerTick: 100 },
      { id: "leaf", name: "Leaf", description: "Second hop", capacityPerTick: 100 },
    ],
    dependencies: [
      { consumerId: "consumer", providerId: "gateway", kind: "required" },
      { consumerId: "leaf", providerId: "consumer", kind: "required" },
    ],
    config: { tickDurationMs: 1000, recoveryTicks: 2, maxTicks: 1000 },
    workload: { id: "normal", name: "Normal", description: "Fixed requests/tick",
      demandPerTick: { gateway: 0, a: 0, b: 0, consumer: 20, leaf: 10 } },
    routingPool: { id: "backends", serviceId: "gateway", memberIds: ["a", "b"], demandPerTick },
  };
}

function advance(topology: SimulationScenario, ticks: number, initial = initializeSimulation(topology)) {
  let state = initial;
  for (let i = 0; i < ticks; i += 1) state = step(topology, state);
  return state;
}

function pool(state: SimulationState) {
  if (!state.routingPool) throw new Error("Missing routing pool state");
  return state.routingPool;
}

function assertAccounting(state: SimulationState) {
  const routing = pool(state);
  const members = Object.values(routing.members);
  expect(routing.assignedRequestsPerTick).toBeLessThanOrEqual(routing.incomingDemandPerTick);
  expect(routing.assignedRequestsPerTick).toBe(members.reduce((sum, member) => sum + member.assignedRequestsPerTick, 0));
  expect(routing.processedRequestsPerTick).toBe(members.reduce((sum, member) => sum + member.processedRequestsPerTick, 0));
  expect(routing.processedRequestsPerTick).toBeLessThanOrEqual(routing.availableCapacityPerTick);
  expect(routing.incomingDemandPerTick).toBe(routing.processedRequestsPerTick + routing.unservedRequestsPerTick);
  expect(routing.unservedRequestsPerTick).toBe(routing.unassignedRequestsPerTick + members.reduce((sum, member) => sum + member.unservedRequestsPerTick, 0));
  for (const [id, member] of Object.entries(routing.members)) {
    expect(member.processedRequestsPerTick).toBeLessThanOrEqual(member.assignedRequestsPerTick);
    expect(member.processedRequestsPerTick).toBeLessThanOrEqual(state.services[id]!.traffic!.availableCapacityPerTick);
    if (state.services[id]!.status === "offline" || state.services[id]!.status === "recovering") {
      expect(member.processedRequestsPerTick).toBe(0);
    }
  }
  const metrics = state.metrics!;
  expect(metrics.incomingRequestsPerTick).toBe(metrics.processedRequestsPerTick + metrics.unservedRequestsPerTick);
  function checkNumbers(value: unknown): void {
    if (typeof value === "number") {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    } else if (typeof value === "object" && value !== null) {
      Object.values(value).forEach(checkNumbers);
    }
  }
  checkNumbers(state);
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

describe("two-instance routing and accounting", () => {
  it("balances 120 requests into 60/60 and never independently duplicates pool demand", () => {
    const topology = scenario();
    const state = advance(topology, 1);
    expect(pool(state).members).toEqual({
      a: { assignedRequestsPerTick: 60, processedRequestsPerTick: 60, unservedRequestsPerTick: 0 },
      b: { assignedRequestsPerTick: 60, processedRequestsPerTick: 60, unservedRequestsPerTick: 0 },
    });
    expect(state.services.a?.traffic?.incomingDemandPerTick).toBe(60);
    expect(state.services.b?.traffic?.utilizationPercent).toBe(66.67);
    expect(state.services.gateway?.status).toBe("healthy");
    expect(state.services.gateway?.traffic?.consecutiveOverloadedTicks).toBe(0);
    expect(state.metrics).toEqual({ incomingRequestsPerTick: 150, processedRequestsPerTick: 150,
      unservedRequestsPerTick: 0, overloadedServices: 0, offlineServices: 0, impactedDownstreamServices: 0 });
    expect(state.events).toEqual([]);
    assertAccounting(state);
  });

  it("assigns an odd remainder by sorted member ID, independent of configured member order", () => {
    const base = scenario(121);
    const reversed = { ...base, routingPool: { ...base.routingPool!, memberIds: ["b", "a"] as const } };
    const state = advance(base, 1);
    expect(pool(state).members.a?.assignedRequestsPerTick).toBe(61);
    expect(pool(state).members.b?.assignedRequestsPerTick).toBe(60);
    expect(advance(reversed, 1)).toEqual(state);
  });

  it("immediately redistributes around a manual failure and raises utilization to 133.33%", () => {
    const topology = scenario();
    const state = failService(topology, initializeSimulation(topology), "a");
    expect(pool(state).routedMemberIds).toEqual(["b"]);
    expect(pool(state).members.a?.processedRequestsPerTick).toBe(0);
    expect(pool(state).members.b).toEqual({ assignedRequestsPerTick: 120, processedRequestsPerTick: 90, unservedRequestsPerTick: 30 });
    expect(state.services.b?.traffic?.utilizationPercent).toBe(133.33);
    expect(state.services.b?.traffic?.consecutiveOverloadedTicks).toBe(1);
    expect(state.services.a?.local).toEqual({ kind: "failed" });
    expect(state.services.gateway?.local).toEqual({ kind: "ready" });
    expect(state.services.gateway?.status).toBe("degraded");
    expect(state.metrics?.overloadedServices).toBe(1); // The logical aggregate is not a second processor.
    expect(state.events.filter(({ type }) => type === "traffic-redistributed")).toHaveLength(1);
    assertAccounting(state);
  });

  it("keeps the logical gateway healthy with one backend when that backend has enough capacity", () => {
    const topology = scenario(60);
    const state = failService(topology, initializeSimulation(topology), "a");
    expect(state.services.gateway?.status).toBe("healthy");
    expect(pool(state).processedRequestsPerTick).toBe(60);
    expect(pool(state).unservedRequestsPerTick).toBe(0);
    expect(advance(topology, 6, state).services.b?.status).toBe("healthy");
    assertAccounting(state);
  });

  it("records all demand as unassigned/unserved when neither backend is eligible", () => {
    const topology = scenario();
    const failedA = failService(topology, initializeSimulation(topology), "a");
    const failedBoth = failService(topology, failedA, "b");
    expect(pool(failedBoth).assignedRequestsPerTick).toBe(0);
    expect(pool(failedBoth).unassignedRequestsPerTick).toBe(120);
    expect(pool(failedBoth).unservedRequestsPerTick).toBe(120);
    expect(pool(failedBoth).processedRequestsPerTick).toBe(0);
    expect(failedBoth.services.gateway?.status).toBe("offline");
    assertAccounting(failedBoth);
  });

  it("handles zero external demand without negative or NaN values", () => {
    const topology = scenario(0);
    const balanced = advance(topology, 2);
    assertAccounting(balanced);
    expect(pool(balanced).status).toBe("healthy");
    const failed = failService(topology, failService(topology, balanced, "a"), "b");
    expect(pool(failed).unservedRequestsPerTick).toBe(0);
    expect(pool(failed).status).toBe("offline");
    assertAccounting(failed);
  });

  it("stops routing when the logical gateway is locally failed and resumes only after repair", () => {
    const topology = scenario();
    let state = failService(topology, initializeSimulation(topology), "gateway");
    expect(pool(state).assignedRequestsPerTick).toBe(0);
    expect(pool(state).unservedRequestsPerTick).toBe(120);
    expect(state.services.a?.local.kind).toBe("ready");
    assertAccounting(state);
    state = repairService(topology, state, "gateway");
    expect(state.services.gateway?.status).toBe("recovering");
    expect(pool(state).processedRequestsPerTick).toBe(0);
    state = advance(topology, 2, state);
    expect(pool(state).processedRequestsPerTick).toBe(120);
    expect(state.services.gateway?.status).toBe("healthy");
  });
});

describe("cascading overload and one-hop dependency propagation", () => {
  it("reproduces a secondary overload failure and downstream cascade without scheduled statuses", () => {
    const topology = scenario();
    const tick1 = failService(topology, initializeSimulation(topology), "a");
    const tick2 = step(topology, tick1);
    const tick3 = step(topology, tick2);
    const tick4 = step(topology, tick3);
    const tick5 = step(topology, tick4);
    expect(tick1.services.consumer?.status).toBe("healthy");
    expect(tick2.services.consumer?.status).toBe("degraded");
    expect(tick2.services.b?.traffic?.consecutiveOverloadedTicks).toBe(2);
    expect(tick3.services.b?.local).toEqual({ kind: "failed", cause: { type: "overload", tick: 3 } });
    expect(tick3.services.gateway?.status).toBe("offline");
    expect(tick3.services.consumer?.status).toBe("degraded");
    expect(pool(tick3).members.b?.assignedRequestsPerTick).toBe(120);
    expect(pool(tick3).members.b?.processedRequestsPerTick).toBe(0);
    expect(pool(tick3).unservedRequestsPerTick).toBe(120);
    expect(tick4.services.consumer?.status).toBe("offline");
    expect(tick4.services.leaf?.status).toBe("degraded");
    expect(tick5.services.leaf?.status).toBe("offline");
    expect(tick4.services.b?.traffic?.incomingDemandPerTick).toBe(0);
    expect(tick5.services.b?.local).toEqual(tick3.services.b?.local);
    for (const state of [tick1, tick2, tick3, tick4, tick5]) assertAccounting(state);
    expect(tick1.metrics?.impactedDownstreamServices).toBe(0);
    expect(tick5.metrics?.impactedDownstreamServices).toBe(2);
  });

  it("derives secondary failure timing from the configured threshold", () => {
    const base = scenario();
    const topology = { ...base, config: { ...base.config, overloadFailureTicks: 5 } };
    const tick1 = failService(topology, initializeSimulation(topology), "a");
    expect(advance(topology, 3, tick1).services.b?.status).toBe("degraded");
    expect(advance(topology, 4, tick1).services.b?.local).toEqual({ kind: "failed", cause: { type: "overload", tick: 5 } });
  });

  it("does not route to a backend unavailable because of a required provider", () => {
    const base = scenario();
    const topology: SimulationScenario = { ...base,
      nodes: [...base.nodes, { id: "identity", name: "Identity", description: "Provider", capacityPerTick: 100 }],
      dependencies: [...base.dependencies, { consumerId: "a", providerId: "identity", kind: "required" }],
      workload: { ...base.workload!, demandPerTick: { ...base.workload!.demandPerTick, identity: 0 } },
    };
    const tick1 = failService(topology, initializeSimulation(topology), "identity");
    expect(pool(tick1).members.a?.assignedRequestsPerTick).toBe(60); // Reads previous provider health.
    const tick2 = step(topology, tick1);
    expect(tick2.services.a?.status).toBe("offline");
    expect(tick2.services.a?.local).toEqual({ kind: "ready" });
    expect(tick2.services.a?.traffic?.consecutiveOverloadedTicks).toBe(0);
    expect(pool(tick2).members.a?.processedRequestsPerTick).toBe(0);
    expect(pool(tick2).members.b?.assignedRequestsPerTick).toBe(120);
    assertAccounting(tick2);
  });

  it("blocks the pool's entire external demand when the logical gateway has a required outage", () => {
    const failedIdentity = failService(failchainScenario, initializeSimulation(failchainScenario), "identity");
    const blocked = step(failchainScenario, failedIdentity);
    expect(blocked.services.gateway?.local).toEqual({ kind: "ready" });
    expect(pool(blocked).assignedRequestsPerTick).toBe(0);
    expect(pool(blocked).unservedRequestsPerTick).toBe(120);
    expect(blocked.services["gateway-a"]?.traffic?.consecutiveOverloadedTicks).toBe(0);
    assertAccounting(blocked);
  });

  it("repairs locally failed backends with the existing delay and clears an active survivor streak when capacity returns", () => {
    const topology = scenario();
    let state = failService(topology, initializeSimulation(topology), "a");
    state = repairService(topology, state, "a"); // Tick 2, ready at 4.
    expect(pool(state).members.a?.processedRequestsPerTick).toBe(0);
    state = step(topology, state); // B trips at tick 3.
    state = repairService(topology, state, "b"); // Tick 4: A returns, B ready at 6.
    expect(state.services.a?.traffic?.consecutiveOverloadedTicks).toBe(1);
    expect(state.services.b?.local).toEqual({ kind: "recovering", readyAtTick: 6 });
    state = step(topology, state);
    expect(state.services.a?.traffic?.consecutiveOverloadedTicks).toBe(2);
    state = step(topology, state); // Rejoined B reduces A's share before it reaches a third overloaded tick.
    expect(pool(state).members.a?.assignedRequestsPerTick).toBe(60);
    expect(state.services.a?.traffic?.consecutiveOverloadedTicks).toBe(0);
    expect(state.services.a?.status).toBe("healthy");
    expect(state.services.b?.status).toBe("healthy");
    expect(state.services.gateway?.status).toBe("healthy");
    assertAccounting(state);
  });

  it("can overload and fail a repaired instance again if its peer remains failed", () => {
    const topology = scenario();
    const failed = advance(topology, 2, failService(topology, initializeSimulation(topology), "a"));
    const restarting = repairService(topology, failed, "a"); // Tick 4, ready 6.
    expect(advance(topology, 1, restarting).services.a?.status).toBe("recovering");
    const retripped = advance(topology, 4, restarting);
    expect(retripped.services.a?.local).toEqual({ kind: "failed", cause: { type: "overload", tick: 8 } });
    expect(retripped.services.b?.local).toEqual(failed.services.b?.local);
    assertAccounting(retripped);
  });
});

describe("FAILCHAIN repeatability, bounds, and validation", () => {
  it.each(["normal", "high", "spike"] as const)("preserves accounting and deterministic ordering under %s demand", (id) => {
    const topology = withWorkload(failchainScenario, id);
    const reordered = { ...topology, nodes: [...topology.nodes].reverse(), dependencies: [...topology.dependencies].reverse(),
      routingPool: { ...topology.routingPool!, memberIds: ["gateway-b", "gateway-a"] as const } };
    function replay(config: SimulationScenario) {
      let state = initializeSimulation(config);
      const states = [state];
      for (let tick = 1; tick <= 16; tick += 1) {
        state = tick === 2 ? failService(config, state, "gateway-a") : step(config, state);
        assertAccounting(state);
        states.push(state);
      }
      return states;
    }
    expect(replay(topology)).toEqual(replay(topology));
    expect(replay(reordered)).toEqual(replay(topology));
  });

  it("runs High at 90/90 and Spike at 135/135 without independent backend demand", () => {
    const high = advance(withWorkload(failchainScenario, "high"), 1);
    expect(pool(high).members["gateway-a"]?.assignedRequestsPerTick).toBe(90);
    expect(high.services["gateway-a"]?.traffic?.utilizationPercent).toBe(100);
    const spike = advance(withWorkload(failchainScenario, "spike"), 1);
    expect(pool(spike).members["gateway-b"]?.assignedRequestsPerTick).toBe(135);
    expect(spike.services["gateway-b"]?.traffic?.utilizationPercent).toBe(150);
  });

  it("emits redistribution/pool transition events only when destinations or health change", () => {
    const topology = scenario();
    const initial = initializeSimulation(topology);
    const tick1 = failService(topology, initial, "a");
    expect(tick1.events[0]?.type).toBe("command-applied");
    expect(tick1.events[1]?.type).toBe("traffic-redistributed");
    expect(tick1.events.at(-1)?.type).toBe("pool-status-changed");
    const tick2 = step(topology, tick1);
    expect(tick2.events.filter((event) => event.tick === 2 && (event.type === "pool-status-changed" || event.type === "traffic-redistributed"))).toEqual([]);
    const failed = advance(topology, 6, tick2);
    expect(failed.events.filter(({ type }) => type === "traffic-redistributed")).toHaveLength(2);
    expect(failed.events.filter(({ type }) => type === "pool-status-changed")).toHaveLength(2);
  });

  it("resets all allocation, processing, failure, and event state, then replays the same cascade", () => {
    const topology = scenario();
    const initial = initializeSimulation(topology);
    const failed = advance(topology, 4, failService(topology, initial, "a"));
    const reset = resetSimulation(topology);
    expect(reset).toEqual(initial);
    expect(pool(reset).assignedRequestsPerTick).toBe(0);
    expect(reset.metrics?.incomingRequestsPerTick).toBe(0);
    expect(reset.events).toEqual([]);
    expect(advance(topology, 4, failService(topology, reset, "a"))).toEqual(failed);
  });

  it("leaves deeply frozen scenarios and previous snapshots unchanged", () => {
    const topology = freezeDeep(structuredClone(scenario()));
    const original = structuredClone(topology);
    let state = freezeDeep(initializeSimulation(topology));
    for (let tick = 1; tick <= 8; tick += 1) {
      const copy = structuredClone(state);
      const next = tick === 1 ? failService(topology, state, "a") : step(topology, state);
      expect(state).toEqual(copy);
      state = freezeDeep(next);
    }
    expect(topology).toEqual(original);
  });

  it("preserves the exact routing snapshot at maxTicks", () => {
    const base = scenario();
    const topology = { ...base, config: { ...base.config, maxTicks: 2 } };
    const final = advance(topology, 2);
    expect(step(topology, final)).toBe(final);
  });

  it("rejects missing/duplicate members, nonzero independent pool demand, and cyclic membership", () => {
    const base = scenario();
    const poolConfig = base.routingPool!;
    expect(() => validateScenario({ ...base, routingPool: { ...poolConfig, memberIds: ["a", "a"] } })).toThrow(/two distinct/);
    expect(() => validateScenario({ ...base, routingPool: { ...poolConfig, memberIds: ["a", "missing"] } })).toThrow(/member/);
    expect(() => validateScenario({ ...base, routingPool: { ...poolConfig, memberIds: ["a", "gateway"] } })).toThrow(/member/);
    for (const id of ["gateway", "a", "b"]) {
      expect(() => validateScenario({ ...base, workload: { ...base.workload!, demandPerTick: { ...base.workload!.demandPerTick, [id]: 1 } } })).toThrow(/zero independent/);
    }
    expect(() => validateScenario({ ...base, dependencies: [...base.dependencies, { consumerId: "a", providerId: "gateway", kind: "required" }] })).toThrow(/cycle/);
    expect(() => validateScenario({ ...base, dependencies: [...base.dependencies, { consumerId: "gateway", providerId: "a", kind: "required" }] })).toThrow(/ordinary dependency/);
  });

  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid pool demand %s", (demandPerTick) => {
    const base = scenario();
    expect(() => validateScenario({ ...base, routingPool: { ...base.routingPool!, demandPerTick } })).toThrow(/safe integer/);
  });

  it("rejects aggregate demand or member capacity that would exceed exact integer accounting", () => {
    const base = scenario();
    expect(() => validateScenario({ ...base, routingPool: { ...base.routingPool!, demandPerTick: Number.MAX_SAFE_INTEGER } })).toThrow(/Aggregate/);
    expect(() => validateScenario({ ...base, nodes: base.nodes.map((node) => node.id === "a"
      ? { ...node, capacityPerTick: Number.MAX_SAFE_INTEGER } : node) })).toThrow(/Aggregate/);
  });
});
