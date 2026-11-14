import type { CSSProperties } from "react";

/** The WebGL viewport fills the panel. Alerts use collision placement or the separate log. */
export const GRAPH_FRAME = { side: 0, top: 0, bottom: 0, cardWidth: 210, cardHeight: 96 } as const;
export const GRAPH_FRAME_STYLE = {
  "--warning-card-width": `${GRAPH_FRAME.cardWidth}px`, "--warning-card-height": `${GRAPH_FRAME.cardHeight}px`,
} as CSSProperties;
