import { afterEach, describe, expect, it, vi } from "vitest";
import { failchainScenario } from "../scenarios/failchain";
import { createIncidentState, reduceIncidentState } from "../incident/incidentState";
import { PLAYBACK_INTERVAL_MS, scheduleIncidentTick } from "./useIncidentPlayback";

afterEach(() => vi.useRealTimers());

describe("incident presentation timer lifecycle", () => {
  it("fires once per interval, with no interval loop or hidden catch-up ticks", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    scheduleIncidentTick(advance);
    vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS - 1);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up on pause, reset, cancellation, or unmount, including StrictMode setup/cleanup/setup", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const strictCleanup = scheduleIncidentTick(advance);
    strictCleanup();
    const cleanup = scheduleIncidentTick(advance);
    vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS);
    expect(advance).toHaveBeenCalledTimes(1);
    cleanup();
    const cancelled = scheduleIncidentTick(advance);
    cancelled();
    cancelled();
    vi.runAllTimers();
    expect(advance).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses reducer token/tick guards even if a stale callback is already queued during Reset", () => {
    vi.useFakeTimers();
    let state = reduceIncidentState(failchainScenario, createIncidentState(failchainScenario), { type: "app", action: { type: "fail" } });
    const queued = { type: "playback-tick" as const, sequence: state.sequence, expectedTick: state.app.simulation.tick };
    const cleanup = scheduleIncidentTick(() => { state = reduceIncidentState(failchainScenario, state, queued); });
    state = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "reset" } });
    cleanup();
    vi.runAllTimers();
    expect(state.app.simulation.tick).toBe(0);
    expect(state.incident).toBeNull();
    const fresh = reduceIncidentState(failchainScenario, state, { type: "app", action: { type: "fail" } });
    expect(reduceIncidentState(failchainScenario, fresh, queued)).toBe(fresh);
    const callback = { ...queued, sequence: fresh.sequence };
    const once = reduceIncidentState(failchainScenario, fresh, callback);
    expect(once.app.simulation.tick).toBe(2);
    expect(reduceIncidentState(failchainScenario, once, callback)).toBe(once);
  });
});
