import { createAppState, reduceAppState } from "../appState";
import type { AppAction, AppState } from "../appState";
import { repairEligibility } from "../simulation/autopilot";
import { withWorkload } from "../scenarios/workloads";
import type { ServiceStatus, SimulationScenario, SimulationState } from "../simulation/types";
import { predictIncident } from "./prediction";
import type { IncidentPrediction } from "./prediction";

export const INCIDENT_TICK_CAP = 18;
export const INCIDENT_ALERT_LIMIT = 40;
export const CRITICAL_IMPACT_THRESHOLD = 6;

export interface IncidentAlert {
  readonly id: string;
  readonly tick: number;
  readonly level: "injection" | "impact" | "critical" | "recovery";
  readonly title: string;
  readonly detail: string;
  readonly serviceId?: string;
}

export interface IncidentSession {
  readonly triggerId: string;
  readonly startedAtTick: number;
  readonly phase: "running" | "paused" | "ended";
  readonly stopReason: "quiet" | "cap" | "max-ticks" | "manual" | "error" | null;
  readonly quietTicks: number;
  readonly affectedIds: readonly string[]; // Observed since injection; not a claim of causation.
  readonly exposureIds: readonly string[];
  readonly peakAffected: number;
  readonly criticalActive: boolean;
  readonly alerts: readonly IncidentAlert[];
  readonly recentIds: readonly string[];
}

export interface IncidentState {
  readonly app: AppState;
  readonly automatic: boolean;
  readonly sequence: number; // Invalidates callbacks from earlier playback sequences.
  readonly incident: IncidentSession | null;
  readonly prediction: IncidentPrediction | null;
}

export type IncidentAction =
  | { readonly type: "app"; readonly action: AppAction }
  | { readonly type: "playback-mode"; readonly automatic: boolean }
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "skip" }
  | { readonly type: "playback-tick"; readonly sequence: number; readonly expectedTick: number };

export function createIncidentState(scenario: SimulationScenario): IncidentState {
  return { app: createAppState(scenario), automatic: true, sequence: 0, incident: null, prediction: null };
}

export function currentImpact(simulation: SimulationState) {
  const offlineIds: string[] = [];
  const degradedIds: string[] = [];
  const recoveringIds: string[] = [];
  for (const [id, service] of Object.entries(simulation.services)) {
    if (service.status === "offline") offlineIds.push(id);
    if (service.status === "degraded") degradedIds.push(id);
    if (service.status === "recovering") recoveringIds.push(id);
  }
  return { offlineIds, degradedIds, recoveringIds, affectedCount: offlineIds.length + degradedIds.length };
}

/** Reverse dependency reachability; pool membership adds potential capacity exposure only. */
export function incidentExposure(scenario: SimulationScenario, triggerId: string): string[] {
  const edges = [...scenario.dependencies, ...(scenario.routingPool ? scenario.routingPool.memberIds.map((providerId) => ({
    consumerId: scenario.routingPool!.serviceId, providerId, kind: "optional" as const,
  })) : [])];
  const reached = new Set([triggerId]);
  const queue = [triggerId];
  for (let index = 0; index < queue.length; index++) {
    for (const edge of edges) {
      if (edge.providerId === queue[index] && !reached.has(edge.consumerId)) {
        reached.add(edge.consumerId);
        queue.push(edge.consumerId);
      }
    }
  }
  return [...reached].filter((id) => id !== triggerId).sort();
}

export function incidentOngoing(simulation: SimulationState): boolean {
  return Object.values(simulation.services).some(({ status }) => status !== "healthy")
    || (simulation.retry?.pendingRequests ?? 0) > 0
    || (simulation.circuitBreaker !== undefined && simulation.circuitBreaker.state !== "closed");
}

function activeScenario(base: SimulationScenario, app: AppState): SimulationScenario {
  return base.workload && base.workload.id !== app.workloadId ? withWorkload(base, app.workloadId) : base;
}

/** Conservative quiescence: do not stop while known delayed engine/controller work exists. */
export function safeToSettle(scenario: SimulationScenario, app: AppState): boolean {
  const simulation = app.simulation;
  if (Object.values(simulation.services).some(({ local, traffic }) => local.kind === "recovering"
    || (traffic?.consecutiveOverloadedTicks ?? 0) > 0)) return false;
  if ((simulation.retry?.pendingRequests ?? 0) > 0) return false;
  if (simulation.circuitBreaker && simulation.circuitBreaker.state !== "closed") return false;
  if (app.autopilotEnabled) {
    // A WAIT reason describes one candidate; another instance may have a later safe action.
    for (const id of scenario.routingPool?.memberIds ?? []) {
      if (simulation.services[id]?.local.kind !== "failed") continue;
      const rejection = repairEligibility(scenario, simulation, app.controller, app.autopilotConfig, id);
      if (!rejection || rejection.rule === "cooldown") return false;
    }
  }
  return true;
}

const rank: Record<ServiceStatus, number> = { healthy: 0, degraded: 1, recovering: 2, offline: 3 };

function observeIncident(scenario: SimulationScenario, session: IncidentSession, previous: SimulationState, next: SimulationState, app: AppState): IncidentSession {
  const names = new Map(scenario.nodes.map(({ id, name }) => [id, name]));
  const name = (id: string) => names.get(id) ?? id;
  const affected = new Set(session.affectedIds);
  const recent = new Set<string>();
  const additions: IncidentAlert[] = [];
  const events = next.events.slice(previous.events.length);
  let meaningful = false;
  for (const [index, event] of events.entries()) {
    const id = `${event.tick}:${previous.events.length + index}`;
    if (event.type === "status-changed") {
      meaningful = true;
      recent.add(event.serviceId);
      if (event.to !== "healthy") affected.add(event.serviceId);
      // Restart initiated is not recovery success; only observed effective improvement qualifies.
      if (event.to === "healthy" || (event.to === "degraded" && rank[event.to] < rank[event.from])) {
        additions.push({ id, tick: event.tick, level: "recovery", serviceId: event.serviceId,
          title: `SERVICE IMPROVED — ${name(event.serviceId)} ${event.to}`, detail: "Engine-confirmed effective status change; other services may remain affected." });
      } else if (event.to === "offline" || event.to === "degraded") {
        // The injected service already has its own confirmed command alert.
        if (event.serviceId !== session.triggerId || event.tick !== session.startedAtTick) additions.push({
          id, tick: event.tick, level: "impact", serviceId: event.serviceId,
          title: `${event.providerIds.length ? "DEPENDENCY IMPACT" : "SERVICE IMPACT"} — ${name(event.serviceId)} ${event.to}`,
          detail: event.providerIds.length ? `Cause: ${event.providerIds.map(name).join(", ")}`
            : scenario.routingPool?.serviceId === event.serviceId ? "Gateway pool capacity or local availability changed."
              : next.services[event.serviceId]?.local.kind === "failed" ? "Local failure confirmed by the engine." : "Engine-calculated service/capacity impact.",
        });
      }
    } else if (["overload-started", "overload-failed", "recovery-completed", "pool-status-changed", "breaker-opened", "breaker-half-opened", "breaker-closed", "stable-recovery-achieved"].includes(event.type)) meaningful = true;
  }
  const count = currentImpact(next).affectedCount;
  const criticalActive = count >= CRITICAL_IMPACT_THRESHOLD;
  if (criticalActive && !session.criticalActive) additions.push({ id: `${next.tick}:critical`, tick: next.tick, level: "critical",
    title: `CRITICAL CASCADE — ${count} services impacted`, detail: `Defined threshold: at least ${CRITICAL_IMPACT_THRESHOLD} services currently degraded or offline. Simulated impact only.` });
  const quietTicks = meaningful ? 0 : session.quietTicks + 1;
  let phase = session.phase;
  let stopReason = session.stopReason;
  if (next.tick >= scenario.config.maxTicks) { phase = "ended"; stopReason = "max-ticks"; }
  else if (phase !== "ended" && next.tick - session.startedAtTick >= INCIDENT_TICK_CAP) { phase = "ended"; stopReason = "cap"; }
  else if (phase === "running" && quietTicks >= 2 && safeToSettle(scenario, app)) { phase = "ended"; stopReason = "quiet"; }
  return { ...session, phase, stopReason, affectedIds: [...affected].sort(), recentIds: [...recent].sort(),
    peakAffected: Math.max(session.peakAffected, count), criticalActive, quietTicks,
    alerts: [...session.alerts, ...additions].slice(-INCIDENT_ALERT_LIMIT) };
}

function advance(base: SimulationScenario, state: IncidentState): IncidentState {
  const app = reduceAppState(base, state.app, { type: "step" });
  if (app.simulation === state.app.simulation) return { ...state, app, incident: state.incident
    ? { ...state.incident, phase: "ended", stopReason: app.simulation.tick >= base.config.maxTicks ? "max-ticks" : "error" } : null };
  return { ...state, app, incident: state.incident ? observeIncident(activeScenario(base, app), state.incident, state.app.simulation, app.simulation, app) : null };
}

/** UI reducer wraps existing application actions; it never writes engine service state. */
function reduceIncidentCore(base: SimulationScenario, state: IncidentState, action: IncidentAction): IncidentState {
  if (action.type === "playback-mode") return { ...state, automatic: action.automatic, sequence: state.sequence + 1,
    incident: state.incident?.phase === "running" ? { ...state.incident, phase: "paused", stopReason: "manual" } : state.incident };
  if (action.type === "pause") return state.incident?.phase === "running"
    ? { ...state, sequence: state.sequence + 1, incident: { ...state.incident, phase: "paused", stopReason: "manual" } } : state;
  if (action.type === "resume") {
    if (!state.incident || state.incident.phase !== "paused" || state.app.simulation.tick - state.incident.startedAtTick >= INCIDENT_TICK_CAP || state.app.simulation.tick >= base.config.maxTicks) return state;
    return { ...state, sequence: state.sequence + 1, incident: { ...state.incident, phase: "running", stopReason: null } };
  }
  if (action.type === "playback-tick") {
    if (state.incident?.phase !== "running" || action.sequence !== state.sequence || action.expectedTick !== state.app.simulation.tick) return state;
    return advance(base, state);
  }
  if (action.type === "skip") {
    if (!state.incident || state.incident.phase === "ended") return state;
    let next: IncidentState = { ...state, sequence: state.sequence + 1, incident: { ...state.incident, phase: "running", stopReason: null } };
    // Bounded synchronous engine steps, with identical event observation and stop rules.
    for (let index = 0; index < INCIDENT_TICK_CAP && next.incident?.phase === "running"; index++) next = advance(base, next);
    return next;
  }
  const command = action.action;
  const app = reduceAppState(base, state.app, command);
  if ((command.type === "reset" || command.type === "workload") && !app.error) return { ...state, app, incident: null, sequence: state.sequence + 1 };
  if (command.type === "select") return { ...state, app };
  // User actions safely pause playback before owning their tick; stale callbacks are invalid.
  const paused = state.incident?.phase === "running" ? { ...state.incident, phase: "paused" as const, stopReason: "manual" as const } : state.incident;
  const nextState = { ...state, app, sequence: state.sequence + 1, incident: paused };
  if (app.simulation === state.app.simulation) return nextState;
  const scenario = activeScenario(base, app);
  const confirmed = command.type === "fail" && app.simulation.events.slice(state.app.simulation.events.length)
    .some((event) => event.type === "command-applied" && event.command === "fail" && event.serviceId === state.app.selectedId);
  if (confirmed && state.app.selectedId) {
    const triggerId = state.app.selectedId;
    const serviceName = scenario.nodes.find(({ id }) => id === triggerId)?.name ?? triggerId;
    const session: IncidentSession = { triggerId, startedAtTick: app.simulation.tick,
      phase: state.automatic ? "running" : "paused", stopReason: state.automatic ? null : "manual", quietTicks: 0,
      affectedIds: [triggerId], exposureIds: incidentExposure(scenario, triggerId), recentIds: [],
      peakAffected: currentImpact(app.simulation).affectedCount,
      criticalActive: currentImpact(state.app.simulation).affectedCount >= CRITICAL_IMPACT_THRESHOLD,
      alerts: [{ id: `${app.simulation.tick}:injection`, tick: app.simulation.tick, level: "injection", serviceId: triggerId,
        title: `FAULT INJECTED — ${serviceName} offline`, detail: "Actual engine fail command confirmed. Fictional infrastructure." }] };
    return { ...nextState, incident: observeIncident(scenario, session, state.app.simulation, app.simulation, app) };
  }
  return { ...nextState, incident: paused ? observeIncident(scenario, paused, state.app.simulation, app.simulation, app) : null };
}

export function reduceIncidentState(base: SimulationScenario, state: IncidentState, action: IncidentAction): IncidentState {
  const next = reduceIncidentCore(base, state, action);
  if (next === state) return state;
  if (!next.incident) return next.prediction ? { ...next, prediction: null } : next;
  if (next.app.simulation !== state.app.simulation || next.app.autopilotEnabled !== state.app.autopilotEnabled
    || next.app.autopilotConfig !== state.app.autopilotConfig) {
    return { ...next, prediction: predictIncident(activeScenario(base, next.app), next.app) };
  }
  return next;
}
