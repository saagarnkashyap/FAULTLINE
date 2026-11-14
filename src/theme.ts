import type { CSSProperties } from "react";

/** Terminal Command: covert green-black surfaces and semantic signal lighting. */
export const DARK_TERMINAL_TOKENS = {
  background: "#070907", canvas: "#0D110D", panel: "#0D110D", raised: "#171D17",
  border: "#4B5848", strongBorder: "#74816B", text: "#E8E6D8", secondary: "#A6AC9A",
  phosphor: "#B5ED8D", energy: "#79C7AF", command: "#E7B466", healthy: "#B5ED8D",
  critical: "#E86765", warning: "#E7B466", recovery: "#B3A3DD", selection: "#E7B466",
} as const;

/** Semantic aliases shared by CSS, status badges, and the WebGL renderer. */
export const UI_COLORS = {
  bg: DARK_TERMINAL_TOKENS.background,
  surface: DARK_TERMINAL_TOKENS.panel,
  elevated: DARK_TERMINAL_TOKENS.raised,
  graph: DARK_TERMINAL_TOKENS.canvas,
  border: DARK_TERMINAL_TOKENS.border,
  "border-strong": DARK_TERMINAL_TOKENS.strongBorder,
  text: DARK_TERMINAL_TOKENS.text,
  secondary: DARK_TERMINAL_TOKENS.secondary,
  muted: DARK_TERMINAL_TOKENS.secondary,
  interaction: DARK_TERMINAL_TOKENS.command,
  brand: DARK_TERMINAL_TOKENS.energy,
  selection: DARK_TERMINAL_TOKENS.selection,
  "action-bg": DARK_TERMINAL_TOKENS.command,
  "action-hover": "#F0C98F",
  "action-text": DARK_TERMINAL_TOKENS.background,
  healthy: DARK_TERMINAL_TOKENS.healthy,
  degraded: DARK_TERMINAL_TOKENS.warning,
  offline: DARK_TERMINAL_TOKENS.critical,
  recovering: DARK_TERMINAL_TOKENS.recovery,
  "healthy-text": DARK_TERMINAL_TOKENS.healthy,
  "degraded-text": DARK_TERMINAL_TOKENS.warning,
  "offline-text": DARK_TERMINAL_TOKENS.critical,
  "recovering-text": DARK_TERMINAL_TOKENS.recovery,
  "link-required": DARK_TERMINAL_TOKENS.energy,
  "link-optional": DARK_TERMINAL_TOKENS.phosphor,
  "link-pool": DARK_TERMINAL_TOKENS.energy,
} as const;

export type ThemeColors = { readonly [Key in keyof typeof UI_COLORS]: string };
/** One fixed command-console palette for both the interface and WebGL scene. */
export const THEME_STYLE = Object.fromEntries(
  Object.entries(UI_COLORS).map(([key, value]) => [`--${key}`, value]),
) as CSSProperties;
