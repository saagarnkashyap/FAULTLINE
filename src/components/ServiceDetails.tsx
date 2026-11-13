import type { Dependency, ServiceId, SimulationScenario, SimulationState } from "../simulation/types";
import { Controls } from "./Controls";
import { StatusBadge } from "./StatusBadge";
import type { AppState } from "../appState";
import { nextRepairTick } from "../simulation/autopilot";

interface Props {
  scenario: SimulationScenario;
  state: SimulationState;
  selectedId: ServiceId | null;
  onSelect: (id: ServiceId) => void;
  onFail: () => void;
  onRepair: () => void;
  autopilot?: Pick<AppState, "autopilotEnabled" | "autopilotConfig" | "controller">;
}

export function ServiceDetails({ scenario, state, selectedId, onSelect, onFail, onRepair, autopilot }: Props) {
  const selected = scenario.nodes.find(({ id }) => id === selectedId);
  const runtime = selected && state.services[selected.id];
  if (!selected || !runtime) {
    return <div className="empty-state"><h3>No service selected</h3><p>Select a node or a service from the list to inspect its dependencies.</p></div>;
  }

  const providers = scenario.dependencies.filter(({ consumerId }) => consumerId === selected.id);
  const consumers = scenario.dependencies.filter(({ providerId }) => providerId === selected.id);
  const pool = scenario.routingPool;
  const isPoolService = selected.id === pool?.serviceId;
  const isPoolMember = pool?.memberIds.includes(selected.id) ?? false;
  const poolState = state.routingPool;
  const memberTraffic = isPoolMember ? poolState?.members[selected.id] : undefined;
  const history = autopilot?.controller.instances[selected.id];
  const repairAt = history && autopilot ? nextRepairTick(history, autopilot.autopilotConfig) : null;
  const localLabel = runtime.local.kind === "ready" ? "Ready" : runtime.local.kind === "failed"
    ? runtime.local.cause?.type === "overload" ? `Failed · overload at tick ${runtime.local.cause.tick}` : "Failed · manual injection"
    : `Restarting · ready at tick ${runtime.local.readyAtTick}`;

  function dependencyList(links: readonly Dependency[], direction: "providers" | "consumers", empty: string) {
    if (!links.length) return <p className="dependency-empty">{empty}</p>;
    return (
      <ul className="dependency-list">
        {links.map((link) => {
          const id = direction === "providers" ? link.providerId : link.consumerId;
          const node = scenario.nodes.find((node) => node.id === id);
          const service = state.services[id];
          return (
            <li key={id}>
              <button type="button" className="dependency-button" onClick={() => onSelect(id)}>
                <span>{node?.name ?? id}</span>
                {direction === "consumers" && <span className="dependency-kind">{link.kind}</span>}
                <span aria-hidden="true">↗</span>
              </button>
              {service && <StatusBadge status={service.status} />}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="service-details">
      <div className="selected-service-heading"><span className="service-glyph" aria-hidden="true">{selected.name.slice(0, 2).toUpperCase()}</span><h3>{selected.name}</h3></div>
      <p className="service-description">{selected.description}</p>
      <Controls runtime={runtime} atLimit={state.tick >= scenario.config.maxTicks} onFail={onFail} onRepair={onRepair} isPoolService={isPoolService} />
      <dl className="service-facts">
        <div><dt>Effective status</dt><dd><StatusBadge status={runtime.status} /></dd></div>
        <div><dt>Local condition</dt><dd>{localLabel}</dd></div>
        {(isPoolMember || isPoolService) && <div><dt>Routing pool</dt><dd>{pool?.id}</dd></div>}
        {runtime.traffic && <>
          <div><dt>Service capacity</dt><dd>{selected.capacityPerTick} requests/tick</dd></div>
          <div><dt>Incoming demand</dt><dd>{runtime.traffic.incomingDemandPerTick} requests/tick</dd></div>
          <div><dt>Available capacity</dt><dd>{runtime.traffic.availableCapacityPerTick} requests/tick</dd></div>
          <div><dt>Utilization</dt><dd>{runtime.traffic.utilizationPercent}%</dd></div>
          {isPoolService ? <div><dt>Overload policy</dt><dd>Per backend instance</dd></div>
            : <div><dt>Overloaded ticks</dt><dd>{runtime.traffic.consecutiveOverloadedTicks} / {scenario.config.overloadFailureTicks ?? 3}</dd></div>}
        </>}
        {memberTraffic && <>
          <div><dt>Assigned requests</dt><dd>{memberTraffic.assignedRequestsPerTick} / tick</dd></div>
          <div><dt>Processed requests</dt><dd>{memberTraffic.processedRequestsPerTick} / tick</dd></div>
          <div><dt>Unserved requests</dt><dd>{memberTraffic.unservedRequestsPerTick} / tick</dd></div>
        </>}
        {isPoolService && poolState && <>
          <div><dt>Pool health</dt><dd><StatusBadge status={poolState.status} /></dd></div>
          <div><dt>Pool incoming</dt><dd>{poolState.incomingDemandPerTick} / tick</dd></div>
          <div><dt>Pool assigned</dt><dd>{poolState.assignedRequestsPerTick} / tick</dd></div>
          <div><dt>Pool throughput</dt><dd>{poolState.processedRequestsPerTick} / tick</dd></div>
          <div><dt>Pool unserved</dt><dd>{poolState.unservedRequestsPerTick} / tick</dd></div>
        </>}
      </dl>
      {autopilot && <section className="inspector-controller" aria-label="Selected service controller information">
        <div className="card-label">AUTOPILOT <span className={`controller-chip ${autopilot.autopilotEnabled ? "is-enabled" : ""}`}>{autopilot.autopilotEnabled ? "Enabled" : "Disabled"}</span></div>
        {history ? <p>{history.repairActions}/{autopilot.autopilotConfig.maxRepairsPerInstance} gateway repairs used · {history.failures} local failures observed.
          {repairAt !== null ? ` Failure cooldown permits repair from tick ${repairAt}; controller budgets still apply.` : " No failure cooldown pending."}</p>
          : <p>Controller repair permissions cover gateway pool instances only.</p>}
      </section>}
      {runtime.traffic && <p className="traffic-note">
        Offered workload: {runtime.traffic.offeredDemandPerTick} requests/tick. Metrics describe the last evaluated tick; unavailable services admit no requests.
      </p>}
      {isPoolService && state.metrics && <p className="traffic-note">
        Run totals per tick: {state.metrics.incomingRequestsPerTick} incoming · {state.metrics.processedRequestsPerTick} processed · {state.metrics.unservedRequestsPerTick} unserved.
        {" "}{state.metrics.overloadedServices} overloaded services · {state.metrics.offlineServices} offline · {state.metrics.impactedDownstreamServices} nonhealthy downstream of this gateway.
      </p>}
      <section className="dependency-section"><h3>Required providers <span>{providers.filter(({ kind }) => kind === "required").length}</span></h3>
        {dependencyList(providers.filter(({ kind }) => kind === "required"), "providers", "No required providers.")}
      </section>
      <section className="dependency-section"><h3>Optional providers <span>{providers.filter(({ kind }) => kind === "optional").length}</span></h3>
        {dependencyList(providers.filter(({ kind }) => kind === "optional"), "providers", "No optional providers.")}
      </section>
      <section className="dependency-section"><h3>Direct dependents <span>{consumers.length}</span></h3>
        {dependencyList(consumers, "consumers", "No direct dependents.")}
      </section>
      {(isPoolService || isPoolMember) && pool && <section className="dependency-section pool-membership">
        <h3>{isPoolService ? "Backend pool members (either can serve)" : "Logical pool service"}</h3>
        <ul className="dependency-list">
          {(isPoolService ? pool.memberIds : [pool.serviceId]).map((id) => <li key={id}>
            <button className="dependency-button" type="button" onClick={() => onSelect(id)}>{scenario.nodes.find((node) => node.id === id)?.name ?? id} ↗</button>
            {state.services[id] && <StatusBadge status={state.services[id].status} />}
          </li>)}
        </ul>
      </section>}
    </div>
  );
}
