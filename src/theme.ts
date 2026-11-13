import type { CSSProperties } from "react";

/** One presentation palette for CSS, status badges, and the WebGL renderer. */
export const UI_COLORS = {
  bg: "#090E17",
  surface: "#111B29",
  elevated: "#172335",
  graph: "#0D1522",
  border: "#29374A",
  "border-strong": "#455B78",
  text: "#F1F5FB",
  secondary: "#A5B6CC",
  muted: "#91A4BE",
  interaction: "#70A7FF",
  healthy: "#52D7AE",
  degraded: "#F5B85C",
  offline: "#FF777F",
  recovering: "#9C91FF",
  "link-required": "#7D94B3",
  "link-optional": "#526783",
  "link-pool": "#91A4C1",
} as const;

export const THEME_STYLE = Object.fromEntries(Object.entries(UI_COLORS).map(([key, value]) => [`--${key}`, value])) as CSSProperties;
