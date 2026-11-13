import type { ServiceRuntime } from "../simulation/types";

interface Props {
  runtime: ServiceRuntime;
  atLimit: boolean;
  onFail: () => void;
  onRepair: () => void;
  isPoolService?: boolean;
}

export function Controls({ runtime, atLimit, onFail, onRepair, isPoolService = false }: Props) {
  return (
    <div className="service-controls">
      <h3>Fault controls</h3>
      <div className="fault-buttons">
        <button className="button button-danger" type="button" onClick={onFail} disabled={atLimit || runtime.local.kind === "failed"}>
          <span aria-hidden="true">↯</span> Fail service
        </button>
        <button className="button button-secondary" type="button" onClick={onRepair} disabled={atLimit || runtime.local.kind !== "failed"}>
          <span aria-hidden="true">↗</span> Repair service
        </button>
      </div>
      <p className="control-hint">
        {atLimit ? "Tick limit reached. Reset to continue." : runtime.local.kind === "failed"
          ? runtime.local.cause?.type === "overload"
            ? "Repair restarts the service and clears its overload counter. Sustained demand can cause another failure."
            : "Repair starts a local restart. Providers must also be available."
          : runtime.local.kind === "recovering"
            ? "Restart in progress. Use Step simulation to advance recovery."
            : runtime.status === "offline" || runtime.status === "degraded"
              ? isPoolService ? "Local gateway is ready. Restore provider availability and backend capacity."
                : (runtime.traffic?.consecutiveOverloadedTicks ?? 0) > 0 ? "Incoming demand exceeds capacity. Sustained overload can cause a local failure."
                  : "Local service is ready. Restore its providers to resolve dependency impact."
              : "Each command advances the simulation by one tick."}
      </p>
    </div>
  );
}
