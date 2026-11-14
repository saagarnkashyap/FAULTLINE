import type { CSSProperties } from "react";

/** One presentation palette for CSS, status badges, and the WebGL renderer. */
export const UI_COLORS = {
  bg: "#03090D",
  surface: "#09141D",
  elevated: "#102331",
  graph: "#040D14",
  border: "#203C4D",
  "border-strong": "#42748C",
  text: "#FFFFFF",
  secondary: "#B7CCD9",
  muted: "#97B4C7",
  interaction: "#5DE7FF",
  brand: "#21CBE8",
  "action-bg": "#07546A",
  "action-hover": "#08677E",
  "action-text": "#FFFFFF",
  healthy: "#38E5C2",
  degraded: "#FFD166",
  offline: "#FF7886",
  recovering: "#C4A1FF",
  "link-required": "#29BBD5",
  "link-optional": "#43788D",
  "link-pool": "#79D8E9",
} as const;

export const THEME_STYLE = Object.fromEntries(Object.entries(UI_COLORS).map(([key, value]) => [`--${key}`, value])) as CSSProperties;
