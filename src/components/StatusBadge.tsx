import type { CSSProperties } from "react";
import type { ServiceStatus } from "../simulation/types";
import { STATUS_PRESENTATION } from "../status";

export function StatusBadge({ status }: { status: ServiceStatus }) {
  const { label } = STATUS_PRESENTATION[status];
  return (
    <span className={`status-badge status-${status}`} style={{ "--status-color": `var(--${status}-text)` } as CSSProperties}>
      <span className="status-dot" aria-hidden="true" />{label}
    </span>
  );
}
