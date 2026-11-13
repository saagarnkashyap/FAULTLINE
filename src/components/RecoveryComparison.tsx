import { useState } from "react";
import { createResilienceExperiment, DEFAULT_RESILIENCE_SETTINGS, RECOVERY_EXPERIMENT } from "../scenarios/resurrection";
import type { ResilienceSettings } from "../scenarios/resurrection";
import { compareRecoveryStrategies } from "../simulation/experiments";
import type { RecoveryComparison as ComparisonResults, RecoveryMetrics, RecoveryRun, ResilienceMetrics } from "../simulation/experiments";
import { EventLog } from "./EventLog";

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

export function RecoveryResults({ comparison }: { comparison: ComparisonResults }) {
  const runs = [comparison.naive, comparison.controlled, comparison.adaptive];
  function format(run: RecoveryRun, key: keyof DisplayMetrics) {
    const value = { ...run.metrics, ...run.resilience }[key];
    if (key === "stableRecoveryTick") return value === null ? "Not recovered" : `Tick ${value}`;
    return key === "peakGatewayUtilizationPercent" ? `${value}%` : value?.toLocaleString("en-US");
  }
  return (
    <>
      <p className="comparison-legend">Different values are marked per metric. No overall winning strategy is assumed.</p>
      <div className="comparison-scroll" tabIndex={0} role="region" aria-label="Recovery strategy results">
        <table className="event-table comparison-table">
          <caption className="sr-only">Isolated gateway recovery comparison over {comparison.durationTicks} simulation ticks</caption>
          <thead><tr><th scope="col">Gateway pool metric</th><th scope="col">Naive</th><th scope="col">Controlled</th><th scope="col">Adaptive</th></tr></thead>
          <tbody>{rows.map(({ label, key }) => {
            const differs = new Set(runs.map((run) => format(run, key))).size > 1;
            return <tr key={key} className={differs ? "metric-varies" : undefined}><th scope="row">{label}{differs && <span className="metric-difference">Different</span>}</th>
            {runs.map((run) => <td key={run.policy}>{format(run, key)}</td>)}</tr>;
          })}</tbody>
        </table>
      </div>
      <div className="comparison-notes">
        <p>Stable recovery requires a healthy gateway and both backends, no pending retries, and a closed breaker when enabled, for three consecutive ticks. It must still hold at the horizon.</p>
        <p>Breaker deferrals count admission decisions, possibly repeatedly for a pending request; they are not backend attempts or new unique arrivals. Retry abandonment excludes fresh requests that were never eligible.</p>
        {runs.map((run) => <details key={run.policy}>
          <summary>{run.policy[0]!.toUpperCase() + run.policy.slice(1)} engine events ({run.finalState.events.length})</summary>
          <EventLog events={run.finalState.events} scenario={RECOVERY_EXPERIMENT.scenario} />
        </details>)}
      </div>
    </>
  );
}

/** Owns only comparison results; has no access to the active manual simulation. */
export function RecoveryComparison() {
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
        <div><h2 id="recovery-heading">RESURRECTION · Recovery experiment</h2><p>Identical failures and repairs. Only documented resilience policies differ.</p></div>
        <button className="button button-primary" type="button" onClick={() => {
          try { setComparison(compareRecoveryStrategies(experiment)); setError(null); }
          catch (failure) { setError(failure instanceof Error ? failure.message : "Comparison could not be completed."); }
        }}>Run Comparison</button>
      </div>
      <div className="comparison-notes">
        <p>Fixed {experiment.scenario.workload!.name} workload · {experiment.durationTicks} ticks · {experiment.scenario.routingPool!.demandPerTick} new gateway requests/tick · {experiment.scenario.config.recoveryTicks}-tick restarts.</p>
        <p>{experiment.schedule.map(({ tick, command }) => `${command.type === "fail" ? "Fail" : "Repair"} ${experiment.scenario.nodes.find(({ id }) => id === command.serviceId)?.name} at tick ${tick}`).join(" · ")}.</p>
        <p><strong>Naive:</strong> release all pending retries when capacity returns. <strong>Controlled:</strong> reserve capacity for new demand, then admit at most {experiment.retry.retryBudgetPerTick} retries/tick within spare capacity.</p>
        <p><strong>Adaptive:</strong> bounded retry admission with optional exponential backoff, seeded cohort jitter, and client circuit-breaker protection.</p>
        <p>All three runs use the same {experiment.retry.maxPendingRequests.toLocaleString("en-US")}-request queue limit, {experiment.retry.maxAgeTicks}-tick request age limit, {experiment.retry.eligibilityPercent}% eligibility, and {settings.maxRetryAttempts} retry-attempt limit. This comparison leaves your manual experiment unchanged.</p>
        <details className="resilience-settings">
          <summary>Adaptive settings · Backoff {settings.backoffEnabled ? "on" : "off"} · Seed {settings.seed} · Breaker {settings.breakerEnabled ? "on" : "off"}</summary>
          <div className="resilience-controls">
            <label><input type="checkbox" checked={settings.backoffEnabled} onChange={(event) => updateSettings({ backoffEnabled: event.currentTarget.checked })} /> Backoff + jitter (Adaptive only)</label>
            {([
              ["baseDelayTicks", "Base delay (ticks)", 1, 64], ["maxDelayTicks", "Maximum delay (ticks)", 1, 256],
              ["jitterTicks", "Jitter window (ticks)", 0, 256], ["seed", "Jitter seed", 0, 4294967295],
              ["maxRetryAttempts", "Maximum retries (all strategies)", 0, 1000],
            ] as const).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} step={1}
              disabled={key !== "maxRetryAttempts" && !settings.backoffEnabled}
              value={Number.isFinite(settings[key]) ? settings[key] : ""}
              onChange={(event) => updateSettings({ [key]: event.currentTarget.valueAsNumber })} /></label>)}
            <label><input type="checkbox" checked={settings.breakerEnabled} onChange={(event) => updateSettings({ breakerEnabled: event.currentTarget.checked })} /> Circuit breaker (Adaptive only)</label>
          </div>
          <p>Breaker: 3 qualifying failure ticks · 3 full cooldown ticks · at most 10 half-open probes/tick. Changing settings clears old results; run again to calculate.</p>
        </details>
      </div>
      {error && <p className="action-error" role="alert">{error}</p>}
      {comparison ? <RecoveryResults comparison={comparison} /> : <p className="comparison-empty">Run the comparison to calculate results. No outcome is assumed.</p>}
    </section>
  );
}
