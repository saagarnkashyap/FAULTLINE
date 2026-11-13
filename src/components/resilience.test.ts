import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createResilienceExperiment } from "../scenarios/resurrection";
import { compareRecoveryStrategies } from "../simulation/experiments";
import { EventLog } from "./EventLog";
import { RecoveryComparison, RecoveryResults } from "./RecoveryComparison";

describe("three-policy resilience comparison presentation", () => {
  it("offers scoped backoff, seed, shared attempt limit, and optional breaker controls without showing invented results", () => {
    const html = renderToStaticMarkup(createElement(RecoveryComparison));
    expect(html).toContain("Adaptive:");
    expect(html).toContain("Backoff + jitter (Adaptive only)");
    expect(html).toContain("Jitter seed");
    expect(html).toContain("1337");
    expect(html).toContain("Maximum retries (all strategies)");
    expect(html).toContain("Circuit breaker (Adaptive only)");
    expect(html).toContain("Run Comparison");
    expect(html).not.toContain("Not recovered");
  });

  it("renders all three real result columns and distinct attempt/deferral metrics", () => {
    const result = compareRecoveryStrategies(createResilienceExperiment());
    const html = renderToStaticMarkup(createElement(RecoveryResults, { comparison: result }));
    expect(html).toContain('scope="col">Naive');
    expect(html).toContain('scope="col">Controlled');
    expect(html).toContain('scope="col">Adaptive');
    expect(html).toContain("Peak retry traffic / tick");
    expect(html).toContain("Successful half-open probes");
    expect(html).toContain("Breaker admission deferrals");
    expect(html).toContain("1,422");
    expect(html).toContain("Tick 32");
    expect(html).toContain("not backend attempts or new unique arrivals");
  });

  it("shows factual backoff and breaker transitions without conflating them with server status", () => {
    const result = compareRecoveryStrategies(createResilienceExperiment());
    const html = renderToStaticMarkup(createElement(EventLog, { events: result.adaptive.finalState.events, scenario: createResilienceExperiment().scenario }));
    expect(html).toContain("Retry backoff scheduled");
    expect(html).toContain("Circuit breaker opened");
    expect(html).toContain("Circuit breaker half-opened");
    expect(html).toContain("Circuit breaker closed");
    expect(html).toContain("Probe succeeded");
    expect(html).not.toContain("Probe failed");
    expect((html.match(/<tr>/g) ?? []).length).toBe(result.adaptive.finalState.events.length + 1);
  });
});
