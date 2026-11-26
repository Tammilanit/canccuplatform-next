/**
 * The theme a device gets in its state (contracts/screen.md, Device API: `theme`): theming's
 * answer cut to what a screen draws, the backdrop with it (theming.md, Reading the current theme).
 */
import { describe, expect, it } from "vitest";
import { themeView } from "../src/compose/state.js";

const THEME = {
  revision: 3,
  tokens_css_url: "/theming/a/t.css",
  css_url: null,
  logo_url: "/theming/a/l.svg",
  layouts: [],
  templates: [],
};

describe("themeView", () => {
  it("carries the theme's backdrop to the device", () => {
    const backdrop = {
      looks: ["glows", "waves"],
      game_art: false,
      daylight: true,
      hype: true,
      image_url: `/theming/a/${"b".repeat(64)}.webp`,
      scrim: 0.8,
    };
    expect(themeView({ ...THEME, backdrop })).toEqual({
      revision: 3,
      tokens_css_url: "/theming/a/t.css",
      css_url: null,
      logo_url: "/theming/a/l.svg",
      templates: [],
      backdrop,
    });
  });

  it("leaves it out for a theming that predates it", () => {
    expect(themeView(THEME)).not.toHaveProperty("backdrop");
  });
});
