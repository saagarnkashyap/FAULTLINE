import type { CSSProperties } from "react";

/** One presentation palette for CSS, status badges, and the WebGL renderer. */
export const UI_COLORS = {
  bg: "#0D0C09",
  surface: "#18150F",
  elevated: "#241E14",
  graph: "#100F0B",
  border: "#4C3B29",
  "border-strong": "#795B3B",
  text: "#F7E9D2",
  secondary: "#C8B69C",
  muted: "#B9A88E",
  interaction: "#F4AA50",
  healthy: "#81D3AA",
  degraded: "#F5BF63",
  offline: "#FF8C72",
  recovering: "#C6B0FF",
  "link-required": "#B99661",
  "link-optional": "#6F5A3E",
  "link-pool": "#D8B77C",
  rust: "#A74426",
} as const;

export const THEME_STYLE = Object.fromEntries(Object.entries(UI_COLORS).map(([key, value]) => [`--${key}`, value])) as CSSProperties;
