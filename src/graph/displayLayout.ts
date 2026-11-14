import type { SimulationScenario } from "../simulation/types";
import { toGraphData } from "./toGraphData";


// Display coordinates only. The topology and every status still come from the scenario/engine.
const enterprisePositions: Record<string, readonly [number, number, number]> = {
  identity: [-70, 240, -4], notifications: [780, 240, 6],
  documents: [-650, 35, 4], email: [-350, 60, -4],
  "gateway-a": [220, 45, -6], "gateway-b": [500, 40, 4], billing: [760, -130, -4],
  gateway: [100, -175, 8], assistant: [-580, -315, 4], support: [-270, -300, -4],
  crm: [400, -330, 4], calendar: [60, -500, -4],
};

/** Fixed renderer-owned coordinates; the default topology uses staggered 2.5D bands. */
export function createDisplayGraph(scenario: SimulationScenario) {
  const graph = toGraphData(scenario);
  if (graph.nodes.length === 12 && graph.nodes.every(({ id }) => enterprisePositions[id])) {
    for (const node of graph.nodes) {
      const [x, y, z] = enterprisePositions[node.id]!;
      Object.assign(node, { x, y, z, fx: x, fy: y, fz: z });
    }
    return graph;
  }
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

/** Badges belong to their actual anchors. Never repack a network into a card grid. */
export function placeGraphLabels(labels: readonly ProjectedLabel[], _width: number, _height: number, _selectedId: string | null): PlacedLabel[] {
  return labels.map((label) => ({ id: label.id, left: label.x - label.width / 2, top: label.y - label.height / 2 }));
}

export interface GraphBounds { readonly id: string; readonly left: number; readonly top: number; readonly width: number; readonly height: number }
export interface GraphLayout { readonly width: number; readonly height: number; readonly nodes: readonly GraphBounds[] }

export function overlaps(a: Omit<GraphBounds, "id">, b: Omit<GraphBounds, "id">, gap = 8): boolean {
  return a.left < b.left + b.width + gap && b.left < a.left + a.width + gap
    && a.top < b.top + b.height + gap && b.top < a.top + a.height + gap;
}

/** Float only a few actionable notices; anything without a clear slot belongs in the log. */
export function placeIncidentCards(ids: readonly string[], layout: GraphLayout): Map<string, GraphBounds> {
  const result = new Map<string, GraphBounds>();
  // Reserve extra height for wrapped forecast/advice text; floating content is capped below this envelope.
  const width = Math.min(210, Math.max(170, layout.width * .22)), height = 136;
  const occupied = [...layout.nodes, { id: "camera-controls", left: layout.width - 340, top: layout.height - 50, width: 328, height: 42 }];
  const candidates: Omit<GraphBounds, "id">[] = [];
  for (let y = 80; y + height < layout.height - 54; y += 24) {
    candidates.push({ left: 14, top: y, width, height }, { left: layout.width - width - 14, top: y, width, height });
  }
  for (const id of ids) {
    if (result.size >= 3) break;
    const candidate = candidates.find((rect) => occupied.every((obstacle) => !overlaps(rect, obstacle, 12)));
    if (!candidate) continue;
    const rect = { id, ...candidate }; result.set(id, rect); occupied.push(rect);
  }
  return result;
}
