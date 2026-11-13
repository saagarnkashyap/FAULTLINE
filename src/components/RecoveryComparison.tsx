import { useState } from "react";
import { createResilienceExperiment, DEFAULT_RESILIENCE_SETTINGS, RECOVERY_EXPERIMENT } from "../scenarios/resurrection";
import type { ResilienceSettings } from "../scenarios/resurrection";
import { compareRecoveryStrategies } from "../simulation/experiments";
import type { RecoveryComparison as ComparisonResults, RecoveryMetrics, RecoveryRun, ResilienceMetrics } from "../simulation/experiments";
import { EventLog } from "./EventLog";
import { ProductTimeline } from "./ProductTimeline";

type DisplayMetrics = RecoveryMetrics & ResilienceMetrics;
const rows: readonly { label: string; key: keyof DisplayMetrics }[] = [
  { label: "Unique gateway requests generated", key: "totalUniqueRequests" },
  { label: "Completed unique requests", key: "completedUniqueRequests" },
  { label: "Retry attempts issued", key: "retryAttempts" },
  { label: "Peak retry traffic / tick", key: "peakRetryTrafficPerTick" },
  { label: "Abandoned / permanently unserved", key: "abandonedRequests" },
  { label: "Backlog remaining", key: "pendingRequests" },
  { label: "Peak gateway utilization", key: "peakGatewayUtilizationPercent" },
  { label: "Overload-induced backend failures", key: "overloadFailures" },
  { label: "Secondary failures after repair", key: "secondaryFailures" },
  { label: "Ticks unavailable", key: "unavailableTicks" },
  { label: "Time to stable recovery", key: "stableRecoveryTick" },
  { label: "Circuit-breaker trips", key: "breakerTrips" },
  { label: "Circuit-breaker open ticks", key: "breakerOpenTicks" },
  { label: "Breaker admission deferrals", key: "deferredAttempts" },
  { label: "Successful half-open probes", key: "successfulHalfOpenProbes" },
  { label: "Retry abandonment (age / queue / limit)", key: "retryAbandonmentCount" },
];

export function RecoveryResults({ comparison, simple = false }: { comparison: ComparisonResults; simple?: boolean }) {
  const runs = [comparison.naive, comparison.controlled, comparison.adaptive];
  const visibleRows = simple ? [
    { label: "Completed requests", key: "completedUniqueRequests" }, { label: "Retry attempts", key: "retryAttempts" },
    { label: "Abandoned requests", key: "abandonedRequests" }, { label: "Waiting requests", key: "pendingRequests" },
    { label: "Peak load", key: "peakGatewayUtilizationPercent" }, { label: "Failures after repair", key: "secondaryFailures" },
    { label: "Recovered at", key: "stableRecoveryTick" },
  ] as const : rows;
  function format(run: RecoveryRun, key: keyof DisplayMetrics) {
    const value = { ...run.metrics, ...run.resilience }[key];
    if (key === "stableRecoveryTick") return value === null ? "Not recovered" : `${simple ? "Step" : "Tick"} ${value}`;
    return key === "peakGatewayUtilizationPercent" ? `${value}%` : value?.toLocaleString("en-US");
  }
  return (
    <>
      <p className="comparison-legend">{simple ? "Same incident. Different recovery. No winner assumed." : "Different values are marked per metric. No overall winning strategy is assumed."}</p>
      <div className="comparison-scroll" tabIndex={0} role="region" aria-label="Recovery strategy results">
        <table className="event-table comparison-table">
          <caption className="sr-only">Gateway recovery comparison over {comparison.durationTicks} {simple ? "steps" : "simulation ticks"}</caption>
          <thead><tr><th scope="col">{simple ? "Impact" : "Gateway pool metric"}</th><th scope="col">Naive</th><th scope="col">Controlled</th><th scope="col">Adaptive</th></tr></thead>
          <tbody>{visibleRows.map(({ label, key }) => {
            const differs = new Set(runs.map((run) => format(run, key))).size > 1;
            return <tr key={key} className={differs ? "metric-varies" : undefined}><th scope="row">{label}{differs && <span className="metric-difference">Different</span>}</th>
            {runs.map((run) => <td key={run.policy}>{format(run, key)}</td>)}</tr>;
          })}</tbody>
        </table>
      </div>
      <details className="comparison-notes" open={!simple}><summary>{simple ? "How recovery is measured" : "Details"}</summary>
        {simple ? <p>Recovered means the gateway and its backups stay healthy with no waiting requests for three steps. Results cover gateway traffic; retry attempts are not new requests.</p> : <>
          <p>Stable recovery requires a healthy gateway and both backends, no pending retries, and a closed breaker when enabled, for three consecutive ticks. It must still hold at the horizon.</p>
          <p>Breaker deferrals count admission decisions, possibly repeatedly for a pending request; they are not backend attempts or new unique arrivals. Retry abandonment excludes fresh requests that were never eligible.</p>
        </>}
        {runs.map((run) => <details key={run.policy}>
          <summary>{run.policy[0]!.toUpperCase() + run.policy.slice(1)} {simple ? "timeline" : "engine events"} ({run.finalState.events.length})</summary>
          {simple ? <ProductTimeline events={run.finalState.events} scenario={RECOVERY_EXPERIMENT.scenario} /> : <EventLog events={run.finalState.events} scenario={RECOVERY_EXPERIMENT.scenario} />}
        </details>)}
      </details>
    </>
  );
}

/** Owns only comparison results; has no access to the active manual simulation. */
export function RecoveryComparison({ simple = false }: { simple?: boolean } = {}) {
  const [comparison, setComparison] = useState<ComparisonResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ResilienceSettings>(DEFAULT_RESILIENCE_SETTINGS);
  const experiment = createResilienceExperiment(settings);
  function updateSettings(patch: Partial<ResilienceSettings>) {
    setSettings((previous) => ({ ...previous, ...patch }));
    setComparison(null);
    setError(null);
  }
  return (
    <section className="panel recovery-panel" aria-labelledby="recovery-heading">
      <div className="incident-toolbar">
        <div><span className="eyebrow">04 / RECOVER</span><h2 id="recovery-heading">{simple ? "Recovery lab" : "RESURRECTION · Recovery experiment"}</h2><p>{simple ? "Three strategies. One incident." : "Identical failures and repairs. Only documented resilience policies differ."}</p></div>
        <button className="button button-primary" type="button" onClick={() => {
          try { setComparison(compareRecoveryStrategies(experiment)); setError(null); }
          catch (failure) { setError(failure instanceof Error ? failure.message : "Comparison could not be completed."); }
        }}>{simple ? "Compare recovery" : "Run Comparison"}</button>
      </div>
      <details className="comparison-notes" open={!simple}><summary>{simple ? "Scenario & settings" : "Experiment settings"}</summary>
        <p>Fixed {experiment.scenario.workload!.name} workload · {experiment.durationTicks} {simple ? "steps" : "ticks"} · {experiment.scenario.routingPool!.demandPerTick} new gateway requests/{simple ? "step" : "tick"} · {experiment.scenario.config.recoveryTicks}-{simple ? "step" : "tick"} restarts.</p>
        <p>{experiment.schedule.map(({ tick, command }) => `${command.type === "fail" ? "Fail" : "Repair"} ${experiment.scenario.nodes.find(({ id }) => id === command.serviceId)?.name} at ${simple ? "step" : "tick"} ${tick}`).join(" · ")}.</p>
        <p><strong>Naive:</strong> release all pending retries when capacity returns. <strong>Controlled:</strong> reserve capacity for new demand, then admit at most {experiment.retry.retryBudgetPerTick} retries/{simple ? "step" : "tick"} within spare capacity.</p>
        <p><strong>Adaptive:</strong> {simple ? "spaces out retries and limits demand while services recover." : "bounded retry admission with optional exponential backoff, seeded cohort jitter, and client circuit-breaker protection."}</p>
        <p>All three runs use the same {experiment.retry.maxPendingRequests.toLocaleString("en-US")}-request queue limit, {experiment.retry.maxAgeTicks}-{simple ? "step" : "tick"} request age limit, {experiment.retry.eligibilityPercent}% eligibility, and {settings.maxRetryAttempts} retry-attempt limit. This comparison leaves your manual experiment unchanged.</p>
        <details className="resilience-settings">
          <summary>Adaptive settings · Backoff {settings.backoffEnabled ? "on" : "off"} · Seed {settings.seed} · Breaker {settings.breakerEnabled ? "on" : "off"}</summary>
          <div className="resilience-controls">
            <label><input type="checkbox" checked={settings.backoffEnabled} onChange={(event) => updateSettings({ backoffEnabled: event.currentTarget.checked })} /> Backoff + jitter (Adaptive only)</label>
            {([
              ["baseDelayTicks", "Base delay (ticks)", 1, 64], ["maxDelayTicks", "Maximum delay (ticks)", 1, 256],
              ["jitterTicks", "Jitter window (ticks)", 0, 256], ["seed", "Jitter seed", 0, 4294967295],
              ["maxRetryAttempts", "Maximum retries (all strategies)", 0, 1000],
            ] as const).map(([key, label, min, max]) => <label key={key}>{simple ? label.replace(/ticks/g, "steps") : label}<input type="number" min={min} max={max} step={1}
              disabled={key !== "maxRetryAttempts" && !settings.backoffEnabled}
              value={Number.isFinite(settings[key]) ? settings[key] : ""}
              onChange={(event) => updateSettings({ [key]: event.currentTarget.valueAsNumber })} /></label>)}
            <label><input type="checkbox" checked={settings.breakerEnabled} onChange={(event) => updateSettings({ breakerEnabled: event.currentTarget.checked })} /> Circuit breaker (Adaptive only)</label>
          </div>
          <p>{simple ? "Protection checks failed requests over 3 steps, waits 3 steps, then tests up to 10 requests. Change settings and compare again." : "Breaker: 3 qualifying failure ticks · 3 full cooldown ticks · at most 10 half-open probes/tick. Changing settings clears old results; run again to calculate."}</p>
        </details>
      </details>
      {error && <p className="action-error" role="alert">{error}</p>}
      {comparison ? <RecoveryResults comparison={comparison} simple={simple} /> : <p className="comparison-empty">{simple ? "Compare how each strategy handles the same failure." : "Run the comparison to calculate results. No outcome is assumed."}</p>}
    </section>
  );
}
