import type { ServiceId, SimulationScenario, SimulationState } from "../simulation/types";
import { STATUS_PRESENTATION } from "../status";
import { UI_COLORS } from "../theme";
import type { ThemeColors } from "../theme";

// These objects belong to the renderer. Physics may add coordinates or replace endpoints.
export interface GraphNode {
  id: ServiceId;
  name: string;
  x?: number;
  y?: number;
  z?: number;
}

export interface GraphLink {
  source: ServiceId | GraphNode;
  target: ServiceId | GraphNode;
  consumerId: ServiceId;
  providerId: ServiceId;
  kind: "required" | "optional" | "pool-member";
}

export interface ServiceGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** Build topology once per scenario, never per tick or selection. */
export function toGraphData(scenario: SimulationScenario): ServiceGraphData {
  return {
    nodes: scenario.nodes.map(({ id, name }) => ({ id, name })),
    links: [...scenario.dependencies.map(({ consumerId, providerId, kind }) => ({
      source: consumerId,
      target: providerId,
      consumerId,
      providerId,
      kind,
    })), ...(scenario.routingPool ? scenario.routingPool.memberIds.map((id) => ({
      source: scenario.routingPool!.serviceId,
      target: id,
      consumerId: scenario.routingPool!.serviceId,
      providerId: id,
      kind: "pool-member" as const,
    })) : [])],
  };
}

/** Appearance reads the actual snapshot without writing status into layout objects. */
export function nodeAppearance(id: ServiceId, state: SimulationState, selectedId: ServiceId | null, recentIds?: readonly ServiceId[], colors: ThemeColors = UI_COLORS) {
  const runtime = state.services[id];
  if (!runtime) throw new Error(`Unknown graph service: ${id}.`);
  return {
    color: colors[runtime.status],
    selected: id === selectedId,
    // nodeVal represents volume: eight times the volume doubles the radius.
    size: id === selectedId ? 8 : recentIds?.includes(id) ? 2 : 1,
  };
}

/** The library treats tooltip strings as HTML, so escape scenario names. */
export function nodeTooltip(node: GraphNode, state: SimulationState, selectedId: ServiceId | null): string {
  const name = escapeTooltip(node.name);
  const runtime = state.services[node.id];
  if (!runtime) throw new Error(`Unknown graph service: ${node.id}.`);
  return `<strong>${name}</strong><br>${STATUS_PRESENTATION[runtime.status].label}${node.id === selectedId ? " · Selected" : ""}`;
}

function escapeTooltip(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

export function linkTooltip(link: GraphLink, scenario: SimulationScenario): string {
  const name = (id: string) => escapeTooltip(scenario.nodes.find((node) => node.id === id)?.name ?? id);
  return `<strong>${name(link.consumerId)} → ${name(link.providerId)}</strong><br>${link.kind === "pool-member"
    ? "Pool membership · either backend can serve" : `${link.kind === "required" ? "Required" : "Optional"} dependency · consumer depends on provider`}`;
}

/** A link reports its provider's current state, not a predicted consumer failure. */
export function linkAppearance(link: GraphLink, state: SimulationState, selectedId: ServiceId | null, colors: ThemeColors = UI_COLORS) {
  const related = link.consumerId === selectedId || link.providerId === selectedId;
  const provider = state.services[link.providerId]?.status;
  const color = provider && provider !== "healthy" ? colors[provider]
    : related ? colors.text : link.kind === "required" ? colors["link-required"]
      : link.kind === "pool-member" ? colors["link-pool"] : colors["link-optional"];
  return { color, width: related ? 1.8 : link.kind === "optional" ? .7 : 1 };
}
