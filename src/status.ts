import type { ServiceStatus } from "./simulation/types";
import { UI_COLORS } from "./theme";

export const STATUS_PRESENTATION: Record<ServiceStatus, { label: string; color: string }> = {
  healthy: { label: "Healthy", color: UI_COLORS.healthy },
  degraded: { label: "Degraded", color: UI_COLORS.degraded },
  offline: { label: "Offline", color: UI_COLORS.offline },
  recovering: { label: "Recovering", color: UI_COLORS.recovering },
};
