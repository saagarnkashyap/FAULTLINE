import { describe, expect, it } from "vitest";
import { createElement as h, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DARK_TERMINAL_TOKENS, THEME_STYLE, UI_COLORS } from "./theme";
import { GraphLabels } from "./graph/GraphLabels";
import { createDisplayGraph } from "./graph/displayLayout";
import { failchainScenario } from "./scenarios/failchain";
import { initializeSimulation } from "./simulation/engine";

describe("Terminal Command color contract", () => {
  it("uses the warm command palette with amber controls and phosphor graph lighting", () => {
    expect(DARK_TERMINAL_TOKENS.background).toBe("#070907");
    expect(THEME_STYLE).toMatchObject({ "--graph": "#0D110D", "--surface": "#0D110D", "--brand": "#79C7AF", "--selection": "#E7B466" });
    expect(UI_COLORS.text).toBe("#E8E6D8");
  });
});

function luminance(hex: string) {
  const [r, g, b] = hex.slice(1).match(/../g)!.map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return r! * .2126 + g! * .7152 + b! * .0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

describe("command module contract", () => {
  it("keeps twelve compact badges attached to the network", () => {
    const graph = createDisplayGraph(failchainScenario);
    const html = renderToStaticMarkup(h("div", { style: THEME_STYLE }, h(GraphLabels, {
      graph, state: initializeSimulation(failchainScenario), selectedId: "gateway", onSelect: () => {}, containerRef: createRef<HTMLDivElement>(),
    })));
    const styles = [...html.matchAll(/class="network-node-label[^"]*" style="([^"]+)"/g)].map((match) => match[1]!);
    expect(styles).toHaveLength(12);
    for (const style of styles) { expect(style).toContain("width:104px"); expect(style).toContain("height:88px"); }
    for (const node of graph.nodes) expect(html).toContain(`<strong>${node.name}</strong>`);
    expect(html).toContain('viewBox="0 0 104 88"');
  });

  it("keeps interface and semantic text readable", () => {
    const colors = UI_COLORS;
    for (const background of [colors.bg, colors.surface, colors.elevated, colors.graph]) {
      for (const text of [colors.text, colors.secondary, colors.muted, colors.interaction,
        colors["healthy-text"], colors["offline-text"], colors["degraded-text"], colors["recovering-text"]]) {
        expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(colors["action-text"], colors["action-bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors["action-text"], colors["action-hover"])).toBeGreaterThanOrEqual(4.5);
  });
});
