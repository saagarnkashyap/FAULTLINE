import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RECOVERY_EXPERIMENT } from "../scenarios/resurrection";
import { compareRecoveryStrategies } from "../simulation/experiments";
import { RecoveryComparison, RecoveryResults } from "./RecoveryComparison";
import { EventLog } from "./EventLog";

describe("RESURRECTION presentation", () => {
  it("explains the fixed, isolated comparison and waits for explicit input before showing outcomes", () => {
    const html = renderToStaticMarkup(createElement(RecoveryComparison));
    expect(html).toContain("Run Comparison");
    expect(html).toContain("Naive:");
    expect(html).toContain("Controlled:");
    expect(html).toContain("at most 30 retries/tick");
    expect(html).toContain("leaves your manual experiment unchanged");
    expect(html).not.toContain("Not recovered");
    expect(html).not.toContain("<table");
  });

  it("shows real calculated values side by side, including Not recovered", () => {
    const comparison = compareRecoveryStrategies(RECOVERY_EXPERIMENT);
    const html = renderToStaticMarkup(createElement(RecoveryResults, { comparison }));
    expect(html).toContain("4,800");
    expect(html).toContain("660");
    expect(html).toContain("733.33%");
    expect(html).toContain("133.33%");
    expect(html).toContain("Tick 29");
    expect(html).toContain("Not recovered");
    expect(html).toContain("Secondary failures after repair");
  });

  it("renders factual retry, repair, restoration, secondary failure, and stable recovery events", () => {
    const comparison = compareRecoveryStrategies(RECOVERY_EXPERIMENT);
    const naive = renderToStaticMarkup(createElement(EventLog, {
      events: comparison.naive.finalState.events, scenario: RECOVERY_EXPERIMENT.scenario,
    }));
    expect(naive).toContain("Repair initiated");
    expect(naive).toContain("Recovery completed");
    expect(naive).toContain("Retry backlog grew");
    expect(naive).toContain("Retry attempts released");
    expect(naive).toContain("Renewed overload");
    expect(naive).toContain("Secondary overload failure");
    expect(naive).not.toContain("Stable recovery achieved");
    const controlled = renderToStaticMarkup(createElement(EventLog, {
      events: comparison.controlled.finalState.events, scenario: RECOVERY_EXPERIMENT.scenario,
    }));
    expect(controlled).toContain("Stable recovery achieved");
    expect(controlled).not.toContain("Secondary overload failure");
  });
});
