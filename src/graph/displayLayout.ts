import type { SimulationScenario } from "../simulation/types";
import { toGraphData } from "./toGraphData";

/** Fixed, layered display coordinates. These belong only to the renderer. */
export function createDisplayGraph(scenario: SimulationScenario) {
  const graph = toGraphData(scenario);
  const providers = new Map(scenario.nodes.map(({ id }) => [id, scenario.dependencies.filter(({ consumerId }) => consumerId === id).map(({ providerId }) => providerId)]));
  if (scenario.routingPool) providers.get(scenario.routingPool.serviceId)!.push(...scenario.routingPool.memberIds);
  const depths = new Map<string, number>();
  function depth(id: string, visiting = new Set<string>()): number {
    if (depths.has(id)) return depths.get(id)!;
    if (visiting.has(id)) return 0;
    const next = new Set(visiting).add(id);
    const result = Math.max(0, ...(providers.get(id) ?? []).map((provider) => depth(provider, next) + 1));
    depths.set(id, result);
    return result;
  }
  for (const node of graph.nodes) depth(node.id);
  const maximum = Math.max(...depths.values());
  const placed = new Map<string, number>();
  for (let level = 0; level <= maximum; level++) {
    const row = graph.nodes.filter(({ id }) => depths.get(id) === level);
    const center = (id: string) => {
      const parents = providers.get(id) ?? [];
      return parents.reduce((sum, parent) => sum + (placed.get(parent) ?? 0), 0) / Math.max(1, parents.length);
    };
    row.sort((a, b) => center(a.id) - center(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    row.forEach((node, index) => {
      const x = (index - (row.length - 1) / 2) * 176;
      const y = (maximum / 2 - level) * 96;
      const z = (index % 2 ? 1 : -1) * 24;
      Object.assign(node, { x, y, z, fx: x, fy: y, fz: z });
      placed.set(node.id, x);
    });
  }
  return graph;
}

export interface ProjectedLabel { readonly id: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface PlacedLabel { readonly id: string; readonly left: number; readonly top: number }

/** Try nearby readable positions before accepting overlap at extreme camera angles. */
export function placeGraphLabels(labels: readonly ProjectedLabel[], width: number, height: number, selectedId: string | null): PlacedLabel[] {
  const occupied: { left: number; top: number; width: number; height: number }[] = [];
  return [...labels].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId)).map((label) => {
    const candidates = [
      { left: label.x - label.width / 2, top: label.y + 27 },
      { left: label.x - label.width / 2, top: label.y - label.height - 27 },
      { left: label.x + 22, top: label.y - label.height / 2 },
      { left: label.x - label.width - 22, top: label.y - label.height / 2 },
      { left: label.x - label.width / 2, top: label.y + label.height + 27 },
      { left: label.x - label.width / 2, top: label.y - 2 * label.height - 27 },
      { left: label.x + 22, top: label.y + 22 },
      { left: label.x - label.width - 22, top: label.y - label.height - 22 },
    ].map((point) => ({ left: Math.max(8, Math.min(width - label.width - 8, point.left)),
      top: Math.max(40, Math.min(height - label.height - 44, point.top)), width: label.width, height: label.height }));
    const chosen = candidates.find((candidate) => occupied.every((other) => candidate.left + candidate.width + 4 < other.left
      || other.left + other.width + 4 < candidate.left || candidate.top + candidate.height + 4 < other.top || other.top + other.height + 4 < candidate.top)) ?? candidates[0]!;
    occupied.push(chosen);
    return { id: label.id, left: chosen.left, top: chosen.top };
  });
}
