import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createAppState, reduceAppState } from "../appState";
import { AUTOPILOT_EXPERIMENT } from "../scenarios/autopilot";
import { failchainScenario } from "../scenarios/failchain";
import { compareAutopilot } from "../simulation/autopilotExperiments";
import { AutopilotPanel, AutopilotResults, AutopilotStatus } from "./AutopilotPanel";

const noop = () => {};

describe("AUTOPILOT presentation", () => {
  it("starts disabled with explicit stepping, cooldown, budgets, and isolated comparison controls", () => {
    const html = renderToStaticMarkup(createElement(AutopilotPanel, {
      state: createAppState(failchainScenario), scenario: failchainScenario, onToggle: noop, onCooldown: noop,
    }));
    expect(html).toContain("Enable AUTOPILOT");
    expect(html).not.toContain('checked=""');
    expect(html).toContain("Disabled · manual simulation");
    expect(html).toContain("Recovery cooldown");
    expect(html).toContain("Manual Fail/Repair takes the entire tick");
    expect(html).toContain("at most 2 repairs/instance and 4 total");
    expect(html).toContain("Compare repair policies");
    expect(html).toContain("leaves manual simulation unchanged");
    expect(html).not.toContain("<table");
  });

  it("shows observed manual failure and cooldown reasoning without claiming recovery", () => {
    let state = createAppState(failchainScenario);
    for (const action of [
      { type: "select", serviceId: "gateway-a" } as const,
      { type: "fail" } as const,
      { type: "autopilot", enabled: true } as const,
      { type: "step" } as const,
    ]) state = reduceAppState(failchainScenario, state, action);
    const html = renderToStaticMarkup(createElement(AutopilotStatus, { state, scenario: failchainScenario, onToggle: noop, onCooldown: noop }));
    expect(html).toContain('checked=""');
    expect(html).toContain("WAIT on next Step (cooldown)");
    expect(html).toContain("manual local failure detected");
    expect(html).toContain("earliest repair tick 4");
    expect(html).toContain("separate from engine events");
    expect(html).not.toContain("Recovery completed");
  });

  it("renders actual comparison metrics and separate factual decision logs", () => {
    const comparison = compareAutopilot(AUTOPILOT_EXPERIMENT);
    const html = renderToStaticMarkup(createElement(AutopilotResults, { comparison }));
    expect(html).toContain("Fixed Runbook");
    expect(html).toContain("AUTOPILOT");
    expect(html).toContain("Offline service-ticks (all services)");
    expect(html).toContain("<td>27</td><td>21</td>");
    expect(html).toContain("Tick 32");
    expect(html).toContain("4,800");
    expect(html).toContain("Fixed runbook slot");
    expect(html).toContain("pool-unavailable");
    expect(html).toContain("An unfinished restart is not confirmed success");
  });

  it("reports Not recovered instead of success when no repairs are allowed", () => {
    const comparison = compareAutopilot({ ...AUTOPILOT_EXPERIMENT,
      controller: { ...AUTOPILOT_EXPERIMENT.controller, maxInterventions: 0 } });
    const html = renderToStaticMarkup(createElement(AutopilotResults, { comparison }));
    expect(html).toContain("Not recovered");
    expect(html).toContain("<td>No</td><td>No</td>");
    expect(html).toContain("budget exhausted");
  });
});
