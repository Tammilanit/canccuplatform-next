/**
 * The zone's scene on a screen (contracts/screen.md, Motion and burn-in drift, `display.scene`;
 * D5, L10, L14): the scene's palette over the theme's primary and accent, the stage's heartbeat at
 * the rate Moments sets, and the blend those colours take (scene.css). Moments decides the scene
 * and the server composes its level, layout and hero; this draws only what is the player's.
 */

export interface SceneView {
  palette?: { primary?: unknown; accent?: unknown } | null;
  quiet?: unknown;
  blend_seconds?: unknown;
  heartbeat_bpm?: unknown;
}

const COLOUR = /^#[0-9a-fA-F]{6}$/;
const PALETTE = { primary: "--canccu-color-primary", accent: "--canccu-color-accent" } as const;
const ALL = ["--canccu-scene-blend", "--canccu-stage-beat", ...Object.values(PALETTE)];

/** The custom properties a scene sets, checked again: a colour goes into the page's style. */
export function sceneStyle(scene: SceneView | undefined): {
  vars: Record<string, string>;
  quiet: boolean;
} {
  if (scene === undefined) return { vars: {}, quiet: false };
  const blend = typeof scene.blend_seconds === "number" ? scene.blend_seconds : 0;
  const bpm = typeof scene.heartbeat_bpm === "number" ? scene.heartbeat_bpm : 8;
  const vars: Record<string, string> = {
    "--canccu-scene-blend": `${Math.min(600, Math.max(0, Math.round(blend)))}s`,
    "--canccu-stage-beat": `${60 / Math.min(30, Math.max(4, bpm))}s`,
  };
  for (const [key, name] of Object.entries(PALETTE)) {
    const colour = scene.palette?.[key as keyof typeof PALETTE];
    if (typeof colour === "string" && COLOUR.test(colour)) vars[name] = colour;
  }
  return { vars, quiet: scene.quiet === true };
}

export class SceneLayer {
  constructor(private readonly body: HTMLElement) {}

  apply(scene: SceneView | undefined): void {
    const { vars, quiet } = sceneStyle(scene);
    for (const name of ALL) {
      const value = vars[name];
      if (value === undefined) this.body.style.removeProperty(name);
      else if (this.body.style.getPropertyValue(name) !== value)
        this.body.style.setProperty(name, value);
    }
    this.body.classList.toggle("canccu-scene", scene !== undefined);
    this.body.classList.toggle("canccu-scene--quiet", quiet);
  }
}
