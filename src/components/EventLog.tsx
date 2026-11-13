import { memo, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { SimulationEvent, SimulationScenario } from "../simulation/types";
import { StatusBadge } from "./StatusBadge";

const EventRow = memo(function EventRow({ event, scenario }: { event: SimulationEvent; scenario: SimulationScenario }) {
  const nameOf = (id: string) => scenario.nodes.find((node) => node.id === id)?.name ?? id;
  let label: string;
  let details: ReactNode;
  switch (event.type) {
    case "command-applied":
      label = `Command applied · ${event.command === "fail" ? "Fail" : "Repair"}`;
      details = <span className="muted">{event.command === "fail" ? "Local failure injected" : "Repair initiated · Local restart requested"}</span>;
      break;
    case "status-changed":
      label = "Status changed";
      details = <><span className="event-transition"><StatusBadge status={event.from} /><span className="transition-arrow" aria-label="to">→</span><StatusBadge status={event.to} /></span>
        {event.providerIds.length > 0 && <span className="event-causes">Cause: {event.providerIds.map(nameOf).join(", ")}</span>}</>;
      break;
    case "overload-started":
    case "overload-failed":
      label = event.type === "overload-started" ? event.afterRepair ? "Renewed overload" : "Overload started"
        : event.afterRepair ? "Secondary overload failure" : "Overload failure";
      details = <span className="muted">{event.demandPerTick} requests/tick / {event.capacityPerTick} capacity · {event.utilizationPercent}% utilization · {event.consecutiveOverloadedTicks} overloaded ticks</span>;
      break;
    case "traffic-redistributed":
      label = "Traffic redistributed";
      details = <span className="muted">
        {event.fromMemberIds.map(nameOf).join(", ") || "No destinations"} → {event.toMemberIds.map(nameOf).join(", ") || "No destinations"}.
        {" "}{Object.entries(event.assignments).map(([id, demand]) => `${nameOf(id)}: ${demand}`).join(" · ")} requests/tick.
        {" "}{event.unassignedRequestsPerTick} unassigned.
      </span>;
      break;
    case "pool-status-changed":
      label = "Pool status changed";
      details = <><span className="event-transition"><StatusBadge status={event.from} /><span className="transition-arrow" aria-label="to">→</span><StatusBadge status={event.to} /></span>
        <span className="event-causes">{event.poolId}: {event.availableCapacityPerTick} capacity · {event.processedRequestsPerTick} processed · {event.unservedRequestsPerTick} unserved / tick</span></>;
      break;
    case "recovery-completed":
      label = "Recovery completed";
      details = <span className="muted">Local restart completed; routing and overload checks apply this tick.</span>;
      break;
    case "retry-attempts-released":
      label = "Retry attempts released";
      details = <span className="muted">{event.attempts} existing requests retried · {event.policy} policy · {event.admissionCapacityPerTick} admission capacity / tick</span>;
      break;
    case "retry-backlog-grew":
      label = "Retry backlog grew";
      details = <span className="muted">{event.pendingBefore} → {event.pendingAfter} pending unique requests</span>;
      break;
    case "retry-requests-abandoned":
      label = "Requests abandoned";
      details = <span className="muted">{event.expired} expired · {event.ineligible} ineligible · {event.overflow} queue overflow{event.attemptLimit ? ` · ${event.attemptLimit} retry limit` : ""}</span>;
      break;
    case "retry-backoff-scheduled":
      label = "Retry backoff scheduled";
      details = <span className="muted">{event.requests} requests in {event.cohorts} cohorts · due ticks {event.earliestTick}–{event.latestTick}</span>;
      break;
    case "breaker-opened":
      label = "Circuit breaker opened";
      details = <span className="muted">{event.reason === "threshold" ? "Qualifying failure threshold reached" : "Half-open probe failed"} · probes eligible at tick {event.nextProbeTick}</span>;
      break;
    case "breaker-half-opened":
      label = "Circuit breaker half-opened";
      details = <span className="muted">At most {event.probeBudget} admitted probe requests this tick</span>;
      break;
    case "breaker-closed":
      label = "Circuit breaker closed";
      details = <span className="muted">All admitted probes succeeded; normal client admission resumes next tick.</span>;
      break;
    case "breaker-probe-result":
      label = event.failed ? "Probe failed" : "Probe succeeded";
      details = <span className="muted">{event.processed} processed probes · {event.failed} failed probes</span>;
      break;
    case "stable-recovery-achieved":
      label = "Stable recovery achieved";
      details = <span className="muted">Gateway and both backends healthy, backlog empty for {event.consecutiveTicks} consecutive ticks.</span>;
      break;
  }
  return (
    <tr>
      <td className="event-tick">{String(event.tick).padStart(4, "0")}</td>
      <td className="event-service">{nameOf(event.serviceId)}</td>
      <td><span className={`event-type ${event.type === "command-applied" ? "event-command" : ""}`}>
        {label}
      </span></td>
      <td>{details}</td>
    </tr>
  );
});

export function EventLog({ events, scenario }: { events: readonly SimulationEvent[]; scenario: SimulationScenario }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const element = scrollRef.current;
    if (!events.length) follow.current = true;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [events.length]);

  return (
    <div className="event-scroll" ref={scrollRef} onScroll={(event) => {
      const element = event.currentTarget;
      follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
    }} tabIndex={0} role="region" aria-label="Chronological simulation events">
      {!events.length ? (
        <div className="log-empty"><span aria-hidden="true">≡</span><div><h3>No incidents recorded</h3><p>Fail a service to begin an experiment. Every command and status change will appear here.</p></div><span className="empty-tag">AWAITING INPUT</span></div>
      ) : (
        <table className="event-table">
          <caption className="sr-only">Simulation events in engine order, oldest first</caption>
          <thead><tr><th scope="col">Tick</th><th scope="col">Service</th><th scope="col">Event</th><th scope="col">Transition / contributing providers</th></tr></thead>
          <tbody>{events.map((event, index) => <EventRow key={index} event={event} scenario={scenario} />)}</tbody>
        </table>
      )}
    </div>
  );
}
