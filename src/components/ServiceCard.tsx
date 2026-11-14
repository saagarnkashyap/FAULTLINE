import type { SimulationScenario, SimulationState } from "../simulation/types";
import { StatusBadge } from "./StatusBadge";
import { ServiceIcon } from "./ServiceIcon";
import type { CSSProperties } from "react";

export function ServiceCard({ scenario, state, selectedId, onSelect, onFail, onRepair }: {
  scenario: SimulationScenario; state: SimulationState; selectedId: string | null;
  onSelect: (id: string) => void; onFail: () => void; onRepair: () => void;
}) {
  const service = scenario.nodes.find(({ id }) => id === selectedId);
  const current = service && state.services[service.id];
  if (!service || !current) return <div className="empty-state"><h3>Select a service</h3><p>Choose a node to inspect it.</p></div>;
  const providers = scenario.dependencies.filter(({ consumerId }) => consumerId === service.id);
  const consumers = scenario.dependencies.filter(({ providerId }) => providerId === service.id);
  const member = state.routingPool?.members[service.id];
  const atLimit = state.tick >= scenario.config.maxTicks;
  return <div className="service-card">
    <div className="service-card-identity"><span className="service-glyph" style={{ "--service-status": `var(--${current.status})` } as CSSProperties}><ServiceIcon serviceId={service.id} /></span><div><p className="command-only inspector-service-id">{service.id}</p><h3>{service.name}</h3><StatusBadge status={current.status} /></div></div>
    <p className="service-card-description">{service.description}</p>
    <section className="inspector-command-bank" aria-label="Service commands">
    <div className="command-only instrument-caption"><span>Command inputs</span><span>MANUAL</span></div>
    <div className="fault-buttons">
      <button className="button button-danger" type="button" disabled={atLimit || current.local.kind === "failed"} onClick={onFail}>Fail service</button>
      <button className="button button-secondary" type="button" disabled={atLimit || current.local.kind !== "failed"} onClick={onRepair}>Repair</button>
    </div>
    <p className={`service-condition condition-${current.local.kind}`}>{current.local.kind === "failed" ? current.local.cause?.type === "overload" ? "Failed under load" : "Manually taken offline"
      : current.local.kind === "recovering" ? `Recovery started · ${Math.max(0, current.local.readyAtTick - state.tick)} steps left`
        : current.status === "offline" ? "Waiting for connected services" : "Ready"}</p>
    </section>
    {current.traffic && <section className="inspector-instruments" aria-label="Service readings"><div className="command-only instrument-caption"><span>System readings</span><span>STEP {state.tick}</span></div><dl className="service-quick-stats">
      <div><dt>Load</dt><dd>{current.traffic.incomingDemandPerTick}<small> requests / step</small></dd></div>
      <div><dt>Capacity</dt><dd>{current.traffic.availableCapacityPerTick}<small> / {service.capacityPerTick}</small></dd></div>
      <div><dt>Utilization</dt><dd>{current.traffic.utilizationPercent}%</dd></div>
      {member && <div><dt>Unserved</dt><dd>{member.unservedRequestsPerTick}<small> / step</small></dd></div>}
    </dl></section>}
    <section className="service-connections"><h4>Needs <span>{providers.length}</span></h4>
      {providers.length ? providers.map(({ providerId, kind }) => <button key={providerId} type="button" onClick={() => onSelect(providerId)}>
        <span>{scenario.nodes.find(({ id }) => id === providerId)?.name}{kind === "optional" && <small>optional</small>}</span><StatusBadge status={state.services[providerId]!.status} />
      </button>) : <p>No upstream services</p>}
    </section>
    <section className="service-connections"><h4>Used by <span>{consumers.length}</span></h4>
      {consumers.length ? consumers.map(({ consumerId }) => <button key={consumerId} type="button" onClick={() => onSelect(consumerId)}>
        <span>{scenario.nodes.find(({ id }) => id === consumerId)?.name}</span><StatusBadge status={state.services[consumerId]!.status} />
      </button>) : <p>No direct connections</p>}
    </section>
    {scenario.routingPool?.memberIds.includes(service.id) && <p className="service-pool-note">Gateway backup · either instance can serve traffic</p>}
  </div>;
}
