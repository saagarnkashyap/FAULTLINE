import { describe, expect, it } from "vitest";
import { UI_COLORS } from "../theme";

function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
}

describe("console action palette", () => {
  it("keeps white action labels readable on both cyan button states", () => {
    for (const background of [UI_COLORS["action-bg"], UI_COLORS["action-hover"]]) {
      expect((luminance(UI_COLORS["action-text"]) + .05) / (luminance(background) + .05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
