import { DEFAULT_AUTOPILOT_CONFIG } from "../simulation/autopilot";
import type { AutopilotExperiment } from "../simulation/autopilotExperiments";
import { createResilienceExperiment } from "./resurrection";

const recovery = createResilienceExperiment();

export const AUTOPILOT_EXPERIMENT: AutopilotExperiment = {
  scenario: { ...recovery.scenario, retry: { ...recovery.retry, policy: "adaptive", ...recovery.adaptive } },
  durationTicks: 40,
  controller: DEFAULT_AUTOPILOT_CONFIG,
  failures: [{ tick: 2, serviceId: "gateway-a" }],
  // Fixed time slots, not a response to observed failures; invalid/blocked slots WAIT.
  runbook: [{ tick: 6, serviceId: "gateway-a" }, { tick: 7, serviceId: "gateway-b" }],
};
