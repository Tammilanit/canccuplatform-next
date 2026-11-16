// @vitest-environment happy-dom
// A zone's scene on the device (contracts/screen.md, Motion and burn-in drift, `display.scene`):
// the palette over the theme's two colours, the heartbeat's rate, the blend, and quiet mode, and
// nothing of it while no scene is known.
import { describe, expect, it } from "vitest";
import { SceneLayer, sceneStyle } from "../src/scene.js";

describe("the scene on a screen", () => {
  it("sets the palette, the heartbeat and the blend as custom properties", () => {
    expect(
      sceneStyle({
        palette: { primary: "#112233", accent: "url(x)" },
        quiet: true,
        blend_seconds: 30,
        heartbeat_bpm: 12,
      }),
    ).toEqual({
      vars: {
        "--canccu-scene-blend": "30s",
        "--canccu-stage-beat": "5s",
        "--canccu-color-primary": "#112233",
      },
      quiet: true,
    });
    expect(sceneStyle(undefined)).toEqual({ vars: {}, quiet: false });
    // Out of range from an older or broken server: the heartbeat stays between 4 and 30 a minute.
    expect(sceneStyle({ heartbeat_bpm: 1000 }).vars["--canccu-stage-beat"]).toBe("2s");
  });

  it("puts the scene on the body and takes all of it off again", () => {
    const body = document.createElement("body");
    const layer = new SceneLayer(body);
    layer.apply({
      palette: { accent: "#abcdef" },
      quiet: true,
      blend_seconds: 0,
      heartbeat_bpm: 8,
    });
    expect(body.classList.contains("canccu-scene")).toBe(true);
    expect(body.classList.contains("canccu-scene--quiet")).toBe(true);
    expect(body.style.getPropertyValue("--canccu-color-accent")).toBe("#abcdef");
    layer.apply({ palette: null, quiet: false, blend_seconds: 0, heartbeat_bpm: 8 });
    expect(body.style.getPropertyValue("--canccu-color-accent")).toBe("");
    expect(body.classList.contains("canccu-scene--quiet")).toBe(false);
    layer.apply(undefined);
    expect(body.classList.contains("canccu-scene")).toBe(false);
    expect(body.style.getPropertyValue("--canccu-stage-beat")).toBe("");
  });
});
