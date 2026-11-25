/**
 * The screen's background as `GET /api/theming/current` answers it (contracts/theming.md, The two
 * backgrounds; plan issue-784 D8): the brand's backdrop with its defaults filled in, and for the
 * organiser's own picture its served address and the scrim that keeps the text readable on it.
 */
import { LOOKS } from "./brand.js";
import { isObject } from "./checks.js";
import type { Manifest } from "./checks.js";
import { contrastRatio } from "./contrast.js";

export interface BackdropView {
  looks: string[];
  game_art: boolean;
  daylight: boolean;
  hype: boolean;
  image_url?: string;
  scrim?: number;
}

/** The package path of the brand's own picture, if it has one. */
export function backdropImage(manifest: Manifest): string | undefined {
  const backdrop = isObject(manifest.brand) ? manifest.brand.backdrop : undefined;
  return isObject(backdrop) && typeof backdrop.image === "string" ? backdrop.image : undefined;
}

const channels = (hex: string): number[] =>
  [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

/** `over` at opacity `alpha` on `under`, as the browser composes the scrim. */
function mix(over: string, under: string, alpha: number): string {
  const [a, b] = [channels(over), channels(under)];
  return `#${a
    .map((c, i) =>
      Math.round(alpha * c + (1 - alpha) * (b[i] ?? 0))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * The least opacity of `background` (0.55–1, in steps of 0.05, as Screen's scrim over game art)
 * at which `text` keeps 4.5:1 over any picture: checked against pure white and pure black under
 * the scrim, the two extremes a picture can hold. Theming does not read the picture's own colours,
 * so the scrim holds for whatever picture the organiser uploads; 1 when no step reaches it.
 */
export function pictureScrim(background: string, text: string): number {
  for (let step = 11; step <= 20; step++) {
    const alpha = step / 20;
    const reads = ["#ffffff", "#000000"].every(
      (under) => contrastRatio(text, mix(background, under, alpha)) >= 4.5,
    );
    if (reads) return alpha;
  }
  return 1;
}

export function backdropView(
  manifest: Manifest,
  colors: Readonly<Record<string, string>>,
  imageUrl?: string,
): BackdropView {
  const b =
    isObject(manifest.brand) && isObject(manifest.brand.backdrop) ? manifest.brand.backdrop : {};
  const flag = (v: unknown): boolean => v !== false;
  const looks = Array.isArray(b.looks)
    ? b.looks.filter((l): l is string => typeof l === "string")
    : [...LOOKS];
  return {
    looks,
    game_art: flag(b.game_art),
    daylight: flag(b.daylight),
    hype: flag(b.hype),
    ...(imageUrl === undefined
      ? {}
      : {
          image_url: imageUrl,
          scrim: pictureScrim(
            (colors.background ?? "#000000").slice(0, 7),
            (colors.text ?? "#ffffff").slice(0, 7),
          ),
        }),
  };
}
