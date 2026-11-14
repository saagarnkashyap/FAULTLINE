import type { CSSProperties } from "react";

/** Reserved card rails surround, but never occupy, the clipped graph viewport. */
export const GRAPH_FRAME = { side: 168, top: 148, bottom: 136, cardHeight: 88, compactSide: 12, compactTop: 244, compactBottom: 244 } as const;
export const GRAPH_FRAME_STYLE = {
  "--warning-side": `${GRAPH_FRAME.side}px`, "--warning-top": `${GRAPH_FRAME.top}px`,
  "--warning-bottom": `${GRAPH_FRAME.bottom}px`, "--warning-card-height": `${GRAPH_FRAME.cardHeight}px`,
  "--warning-compact-side": `${GRAPH_FRAME.compactSide}px`, "--warning-compact-top": `${GRAPH_FRAME.compactTop}px`,
  "--warning-compact-bottom": `${GRAPH_FRAME.compactBottom}px`,
} as CSSProperties;
