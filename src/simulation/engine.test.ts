import { describe, expect, it } from "vitest";
import { enterpriseScenario } from "../scenarios/enterprise";
import {
  failService,
  initializeSimulation,
  repairService,
  resetSimulation,
  step,
  validateScenario,
} from "./engine";
import type {
  Dependency,
  LocalCondition,
  ServiceRuntime,
  ServiceStatus,
  SimulationCommand,
  SimulationConfig,
  SimulationScenario,
  SimulationState,
} from "./types";

function scenario(
  ids: string[] = ["A", "B", "C", "D"],
  dependencies: readonly Dependency[] = [
    { consumerId: "B", providerId: "A", kind: "required" },
    { consumerId: "C", providerId: "B", kind: "required" },
  ],
): SimulationScenario {
  return {
    id: "test-enterprise",
    nodes: ids.map((id) => ({ id, name: id, description: `Service ${id}` })),
    dependencies,
    config: { tickDurationMs: 1000, recoveryTicks: 2, maxTicks: 1000 },
  };
}

function statuses(state: SimulationState): Record<string, ServiceStatus> {
  return Object.fromEntries(Object.entries(state.services).map(([id, service]) => [id, service.status]));
}

function service(state: SimulationState, id: string): ServiceRuntime {
  const result = state.services[id];
  if (!result) throw new Error(`Missing test service: ${id}`);
  return result;
}

function freezeDeep<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

describe("initialization and reset", () => {
  it("initializes ready/healthy services at tick zero with no events", () => {
    const state = initializeSimulation(scenario());
    expect(state.tick).toBe(0);
    expect(state.events).toEqual([]);
    expect(statuses(state)).toEqual({ A: "healthy", B: "healthy", C: "healthy", D: "healthy" });
    expect(Object.values(state.services).every(({ local }) => local.kind === "ready")).toBe(true);
  });

  it("resets to a fresh initial state without retaining failures or events", () => {
    const topology = scenario();
    const initial = initializeSimulation(topology);
    const failed = failService(topology, initial, "A");
    const reset = resetSimulation(topology);
    expect(reset).toEqual(initial);
    expect(reset).toEqual(resetSimulation(topology));
    expect(reset).not.toBe(initial);
    expect(reset.services).not.toBe(initial.services);
    expect(service(failed, "A").status).toBe("offline");
  });

  it("validates and initializes the ten-service fictional scenario", () => {
    expect(() => validateScenario(enterpriseScenario)).not.toThrow();
    expect(Object.keys(initializeSimulation(enterpriseScenario).services)).toHaveLength(10);
    expect(enterpriseScenario.config).toEqual({ tickDurationMs: 1000, recoveryTicks: 2, maxTicks: 1000 });
  });
});

describe("directed, synchronous propagation", () => {
  it("follows C -> B -> A with one hop per tick and no local failures in consumers", () => {
    const topology = scenario();
    const tick1 = failService(topology, initializeSimulation(topology), "A");
    const tick2 = step(topology, tick1);
    const tick3 = step(topology, tick2);
    expect(statuses(tick1)).toEqual({ A: "offline", B: "healthy", C: "healthy", D: "healthy" });
    expect(statuses(tick2)).toEqual({ A: "offline", B: "offline", C: "healthy", D: "healthy" });
    expect(statuses(tick3)).toEqual({ A: "offline", B: "offline", C: "offline", D: "healthy" });
    expect(service(tick3, "B").local).toEqual({ kind: "ready" });
    expect(service(tick3, "C").local).toEqual({ kind: "ready" });
    expect(tick3.tick).toBe(3);
  });

  it("does not propagate a consumer's failure toward its providers", () => {
    const topology = scenario();
    let state = failService(topology, initializeSimulation(topology), "C");
    state = step(topology, step(topology, state));
    expect(statuses(state)).toEqual({ A: "healthy", B: "healthy", C: "offline", D: "healthy" });
  });

  it("propagates fan-out simultaneously while the enterprise billing branch stays healthy", () => {
    let state = failService(enterpriseScenario, initializeSimulation(enterpriseScenario), "identity");
    state = step(enterpriseScenario, state);
    for (const id of ["gateway", "email", "documents"]) {
      expect(service(state, id).status).toBe("offline");
    }
    expect(service(state, "crm").status).toBe("healthy");
    for (let i = 0; i < 5; i += 1) state = step(enterpriseScenario, state);
    expect(service(state, "support").status).toBe("offline");
    expect(service(state, "billing").status).toBe("healthy");
    expect(service(state, "notifications").status).toBe("healthy");
  });

  it("propagates optional degradation through a required dependency on the next tick", () => {
    const topology = scenario(["A", "B", "C"], [
      { consumerId: "B", providerId: "A", kind: "optional" },
      { consumerId: "C", providerId: "B", kind: "required" },
    ]);
    const tick1 = failService(topology, initializeSimulation(topology), "A");
    const tick2 = step(topology, tick1);
    const tick3 = step(topology, tick2);
    expect(statuses(tick2)).toEqual({ A: "offline", B: "degraded", C: "healthy" });
    expect(statuses(tick3)).toEqual({ A: "offline", B: "degraded", C: "degraded" });
  });
});

describe("status precedence and event causes", () => {
  it.each([
    ["required", "healthy", "healthy"],
    ["required", "degraded", "degraded"],
    ["required", "offline", "offline"],
    ["required", "recovering", "offline"],
    ["optional", "healthy", "healthy"],
    ["optional", "degraded", "degraded"],
    ["optional", "offline", "degraded"],
    ["optional", "recovering", "degraded"],
  ] as const)("%s provider that is %s makes a ready consumer %s", (kind, providerStatus, expected) => {
    const topology = scenario(["A", "B"], [{ consumerId: "B", providerId: "A", kind }]);
    const initial = initializeSimulation(topology);
    // Supply a previous-tick provider snapshot to exercise the dependency truth table.
    const previous: SimulationState = {
      ...initial,
      services: { ...initial.services, A: { local: { kind: "ready" }, status: providerStatus } },
    };
    expect(service(step(topology, previous), "B").status).toBe(expected);
  });

  it("keeps only required blocking causes, sorted, when optional degradation also exists", () => {
    const topology = scenario(["consumer", "z", "a", "optional"], [
      { consumerId: "consumer", providerId: "z", kind: "required" },
      { consumerId: "consumer", providerId: "optional", kind: "optional" },
      { consumerId: "consumer", providerId: "a", kind: "required" },
    ]);
    const initial = initializeSimulation(topology);
    const offline: ServiceRuntime = { local: { kind: "failed" }, status: "offline" };
    const previous: SimulationState = {
      ...initial,
      services: { ...initial.services, z: offline, a: offline, optional: offline },
    };
    expect(step(topology, previous).events).toEqual([
      { type: "status-changed", tick: 1, serviceId: "consumer", from: "healthy", to: "offline", providerIds: ["a", "z"] },
    ]);
  });

  it("sorts multiple degrading causes and status events by service ID after the command", () => {
    const topology = scenario(["z", "consumer", "a", "unrelated"], [
      { consumerId: "consumer", providerId: "z", kind: "optional" },
      { consumerId: "consumer", providerId: "a", kind: "required" },
    ]);
    const initial = initializeSimulation(topology);
    const previous: SimulationState = {
      ...initial,
      services: {
        ...initial.services,
        z: { local: { kind: "failed" }, status: "offline" },
        a: { local: { kind: "ready" }, status: "degraded" },
      },
    };
    const next = failService(topology, previous, "unrelated");
    expect(next.events).toEqual([
      { type: "command-applied", tick: 1, serviceId: "unrelated", command: "fail" },
      { type: "status-changed", tick: 1, serviceId: "a", from: "degraded", to: "healthy", providerIds: [] },
      { type: "status-changed", tick: 1, serviceId: "consumer", from: "healthy", to: "degraded", providerIds: ["a", "z"] },
      { type: "status-changed", tick: 1, serviceId: "unrelated", from: "healthy", to: "offline", providerIds: [] },
    ]);
    expect(step(topology, next).events.filter(({ serviceId }) => serviceId === "z")).toEqual([]);
  });

  it.each(["failed", "recovering"] as const)("local %s takes precedence over dependency causes", (kind) => {
    const topology = scenario(["A", "B"], [{ consumerId: "B", providerId: "A", kind: "required" }]);
    const initial = initializeSimulation(topology);
    const local: LocalCondition = kind === "failed" ? { kind } : { kind, readyAtTick: 10 };
    const previous: SimulationState = {
      ...initial,
      services: {
        A: { local: { kind: "failed" }, status: "offline" },
        B: { local, status: "healthy" },
      },
    };
    const next = step(topology, previous);
    expect(service(next, "B").status).toBe(kind === "failed" ? "offline" : "recovering");
    expect(next.events).toContainEqual({
      type: "status-changed", tick: 1, serviceId: "B", from: "healthy",
      to: kind === "failed" ? "offline" : "recovering", providerIds: [],
    });
  });
});

describe("repair and delayed recovery", () => {
  it("matches the documented repair-at-tick-4 sequence through tick 8", () => {
    const topology = scenario();
    let state = failService(topology, initializeSimulation(topology), "A");
    state = step(topology, step(topology, state));
    state = repairService(topology, state, "A");
    expect(state.tick).toBe(4);
    expect(service(state, "A")).toEqual({ local: { kind: "recovering", readyAtTick: 6 }, status: "recovering" });
    expect(statuses(state)).toEqual({ A: "recovering", B: "offline", C: "offline", D: "healthy" });
    state = step(topology, state);
    expect(service(state, "A").status).toBe("recovering");
    state = step(topology, state);
    expect(state.tick).toBe(6);
    expect(statuses(state)).toEqual({ A: "healthy", B: "offline", C: "offline", D: "healthy" });
    state = step(topology, state);
    expect(statuses(state)).toEqual({ A: "healthy", B: "healthy", C: "offline", D: "healthy" });
    state = step(topology, state);
    expect(state.tick).toBe(8);
    expect(statuses(state)).toEqual({ A: "healthy", B: "healthy", C: "healthy", D: "healthy" });
    expect(service(state, "B").local).toEqual({ kind: "ready" });
    expect(state.events).toContainEqual({ type: "command-applied", tick: 4, serviceId: "A", command: "repair" });
  });

  it("does not bypass another failed required provider after a local repair completes", () => {
    const topology = scenario(["A", "B"], [{ consumerId: "B", providerId: "A", kind: "required" }]);
    let state = failService(topology, initializeSimulation(topology), "A");
    state = failService(topology, state, "B");
    state = repairService(topology, state, "B");
    expect(service(state, "B").status).toBe("recovering");
    state = step(topology, step(topology, state));
    expect(service(state, "B")).toEqual({ local: { kind: "ready" }, status: "offline" });
  });

  it("failing a recovering service cancels its pending restart", () => {
    const topology = scenario();
    let state = failService(topology, initializeSimulation(topology), "A");
    state = repairService(topology, state, "A");
    state = failService(topology, state, "A");
    for (let i = 0; i < 4; i += 1) state = step(topology, state);
    expect(service(state, "A")).toEqual({ local: { kind: "failed" }, status: "offline" });
  });

  it("applies a fail command after a restart completing on the same tick", () => {
    const topology = scenario();
    let state = failService(topology, initializeSimulation(topology), "A");
    state = repairService(topology, state, "A"); // Ready at tick 4.
    state = step(topology, state);
    state = failService(topology, state, "A");
    expect(state.tick).toBe(4);
    expect(service(state, "A")).toEqual({ local: { kind: "failed" }, status: "offline" });
  });
});

describe("determinism and immutability", () => {
  function replay(topology: SimulationScenario): SimulationState[] {
    let state = initializeSimulation(topology);
    const states = [state];
    for (let tick = 1; tick <= 10; tick += 1) {
      const command: SimulationCommand | undefined = tick === 1
        ? { type: "fail", serviceId: "A" }
        : tick === 4 ? { type: "repair", serviceId: "A" } : undefined;
      state = step(topology, state, command);
      states.push(state);
    }
    return states;
  }

  it("replays identical snapshots/events regardless of node or dependency array order", () => {
    const topology = scenario();
    const reordered = { ...topology, nodes: [...topology.nodes].reverse(), dependencies: [...topology.dependencies].reverse() };
    expect(replay(topology)).toEqual(replay(topology));
    expect(replay(reordered)).toEqual(replay(topology));
  });

  it("leaves frozen scenario, previous states, nested logs, and commands unchanged", () => {
    const topology = freezeDeep(scenario());
    const initial = freezeDeep(initializeSimulation(topology));
    const initialCopy = structuredClone(initial);
    const command = freezeDeep<SimulationCommand>({ type: "fail", serviceId: "A" });
    const failed = freezeDeep(step(topology, initial, command));
    const failedCopy = structuredClone(failed);
    const recovering = freezeDeep(repairService(topology, failed, "A"));
    step(topology, recovering);
    resetSimulation(topology);
    expect(initial).toEqual(initialCopy);
    expect(failed).toEqual(failedCopy);
    expect(command).toEqual({ type: "fail", serviceId: "A" });
  });

  it("handles valid IDs that coincide with object prototype properties", () => {
    const topology = scenario(["__proto__", "constructor"], [
      { consumerId: "constructor", providerId: "__proto__", kind: "required" },
    ]);
    const state = step(topology, failService(topology, initializeSimulation(topology), "__proto__"));
    expect(service(state, "constructor").status).toBe("offline");
    expect(Object.keys(state.services)).toEqual(["__proto__", "constructor"]);
  });
});

describe("invalid scenarios and commands", () => {
  const base = scenario();
  it.each([
    ["empty scenario ID", { ...base, id: " " }, /Scenario ID/],
    ["no services", { ...base, nodes: [] }, /contain services/],
    ["empty service ID", { ...base, nodes: [{ id: " ", name: "Empty", description: "" }] }, /Service ID/],
    ["duplicate service IDs", { ...base, nodes: [...base.nodes, base.nodes[0]!] }, /Duplicate service/],
    ["unknown provider", scenario(["A"], [{ consumerId: "A", providerId: "missing", kind: "required" }]), /endpoint/],
    ["unknown consumer", scenario(["A"], [{ consumerId: "missing", providerId: "A", kind: "required" }]), /endpoint/],
    ["self link", scenario(["A"], [{ consumerId: "A", providerId: "A", kind: "optional" }]), /Self-dependency/],
    ["duplicate pair", { ...base, dependencies: [...base.dependencies, { consumerId: "B", providerId: "A", kind: "optional" }] }, /Duplicate dependency/],
    ["cycle", { ...base, dependencies: [...base.dependencies, { consumerId: "A", providerId: "C", kind: "required" }] }, /cycle/],
  ] as const)("rejects %s during validation and initialization", (_label, invalid, message) => {
    expect(() => validateScenario(invalid)).toThrow(message);
    expect(() => initializeSimulation(invalid)).toThrow(message);
  });

  const configKeys: (keyof SimulationConfig)[] = ["tickDurationMs", "recoveryTicks", "maxTicks"];
  it.each(configKeys)("rejects nonpositive, fractional, and nonfinite %s values", (key) => {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => validateScenario({ ...base, config: { ...base.config, [key]: value } })).toThrow(/positive safe integer/);
    }
  });

  it("rejects tick configuration that would overflow a recovery deadline", () => {
    expect(() => validateScenario({ ...base, config: { ...base.config, maxTicks: Number.MAX_SAFE_INTEGER } })).toThrow(/safe integer arithmetic/);
  });

  it("rejects unknown dependency kinds at the runtime boundary", () => {
    const invalid = { ...base, dependencies: [{ consumerId: "B", providerId: "A", kind: "invalid" } as unknown as Dependency] };
    expect(() => validateScenario(invalid)).toThrow(/dependency kind/);
  });

  it("throws readable errors for invalid commands without changing prior state", () => {
    const initial = freezeDeep(initializeSimulation(base));
    const initialCopy = structuredClone(initial);
    expect(() => failService(base, initial, "missing")).toThrow(/Unknown command service/);
    expect(() => failService(base, initial, "toString")).toThrow(/Unknown command service/);
    expect(() => repairService(base, initial, "A")).toThrow(/locally failed/);
    expect(() => step(base, initial, { type: "invalid", serviceId: "A" } as unknown as SimulationCommand)).toThrow(/Unknown simulation command/);
    expect(initial).toEqual(initialCopy);

    const failed = freezeDeep(failService(base, initial, "A"));
    expect(() => failService(base, failed, "A")).toThrow(/already locally failed/);
    const dependencyOffline = freezeDeep(step(base, failed));
    expect(() => repairService(base, dependencyOffline, "B")).toThrow(/locally failed/);
    const recovering = freezeDeep(repairService(base, failed, "A"));
    expect(() => repairService(base, recovering, "A")).toThrow(/locally failed/);
  });
});

describe("maximum tick limit", () => {
  it("allows the final tick then preserves state/logs for further steps and valid commands", () => {
    const topology = { ...scenario(), config: { tickDurationMs: 1000, recoveryTicks: 2, maxTicks: 2 } };
    const tick1 = failService(topology, initializeSimulation(topology), "A");
    const final = freezeDeep(step(topology, tick1));
    expect(final.tick).toBe(2);
    expect(step(topology, final)).toBe(final);
    expect(failService(topology, final, "D")).toBe(final);
    expect(repairService(topology, final, "A")).toBe(final);
    expect(resetSimulation(topology).tick).toBe(0);
  });
});
