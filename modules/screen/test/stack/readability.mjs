// The readability check on the rendered screens (#191, L7; contracts/theming.md, Advanced mode:
// "CI's rendered readability check catches what a static check cannot"). The browser collects
// every piece of text it draws (collectSamples, run in the page); the rules are judged here, pure,
// so test/stack-readability.test.ts holds them without a stack or a browser:
// - size: no text under 2.5 % of the screen's short side (27 px at 1080p, 54 px at 4K). The short
//   side, not the height, so a portrait screen, the same panel turned, keeps the same letters;
// - contrast (the theming contract's rules, WCAG 2.2 ratio): text in the theme's primary, accent
//   or a status colour at least 3:1 on its ground, any other text 4.5:1, on every ground under it
//   (each stop of a gradient, see-through grounds laid over what is below);
// - clipping: no text cut by the box around it (a card's edge through its last line). Text a box
//   ends on purpose is fine: an ellipsis or a line clamp cuts inside the text's own box, and a
//   marquee's text runs through its box while an endless animation moves it.

// The colour functions a computed value may hold. Chrome resolves named colours, hsl() and hwb()
// to rgb(), but keeps oklab(), oklch(), lab(), lch() and color() as written (CSS Color 4), so one
// read as black or transparent let unreadable text pass (#549). What is not read here is reported.
const COLOR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|\bcolor-mix\(/gi;

/** A number of a colour function: `none` is 0, a percentage a share of `full`. */
const num = (v, full = 1) =>
  v === "none" ? 0 : v.endsWith("%") ? (parseFloat(v) / 100) * full : Number(v);

/** Linear-light sRGB, 0–1, as [r, g, b] in 0–255, out-of-gamut channels clipped. */
const encoded = (rgb) =>
  rgb.map((c) => {
    const v = Math.min(1, Math.max(0, c));
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  });

/** OKLab to sRGB (Björn Ottosson's matrices, as CSS Color 4 gives them). */
function fromOklab(L, a, b) {
  const [l, m, s] = [
    L + 0.3963377774 * a + 0.2158037573 * b,
    L - 0.1055613458 * a - 0.0638541728 * b,
    L - 0.0894841775 * a - 1.291485548 * b,
  ].map((v) => v ** 3);
  return encoded([
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]);
}

/** One colour as [r, g, b, a] with r, g, b in 0–255; null for one this check cannot read. */
export function readColor(value) {
  const text = String(value).trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text)?.[1];
  if (hex !== undefined) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const n = (i) => parseInt(full.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
  }
  const m = /^([a-z]+)\(([^()]*)\)$/i.exec(text);
  if (m === null) return null;
  const [body, alpha] = m[2].split("/");
  const args = body.split(/[\s,]+/).filter(Boolean);
  const name = m[1].toLowerCase();
  let rgb = null;
  let a = alpha === undefined ? 1 : num(alpha.trim());
  if (name === "rgb" || name === "rgba") {
    rgb = args.slice(0, 3).map((v) => num(v, 255));
    if (args[3] !== undefined) a = num(args[3]);
  } else if (name === "color" && args[0] === "srgb")
    rgb = args.slice(1, 4).map((v) => num(v) * 255);
  else if (name === "oklab") rgb = fromOklab(num(args[0]), num(args[1], 0.4), num(args[2], 0.4));
  else if (name === "oklch") {
    const [c, h] = [num(args[1], 0.4), (num(args[2]) * Math.PI) / 180];
    rgb = fromOklab(num(args[0]), c * Math.cos(h), c * Math.sin(h));
  }
  if (rgb === null || rgb.length !== 3 || [...rgb, a].some((v) => !Number.isFinite(v))) return null;
  return [...rgb, a];
}

/** Every colour written in a computed CSS value, as it stands there. */
const colorsIn = (value) => [...String(value).matchAll(COLOR)].map((m) => m[0]);

/** Every colour in a computed CSS value this check can read, as readColor() gives it. */
export function parseColors(value) {
  return colorsIn(value)
    .map(readColor)
    .filter((c) => c !== null);
}

/** The colours in a computed CSS value this check cannot read. */
export const unreadColors = (value) => colorsIn(value).filter((c) => readColor(c) === null);

/** `top` painted over the opaque `under`. */
function over(top, under) {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
}

const channel = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** The WCAG 2.2 contrast ratio of two opaque colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The grounds a text may stand on: its ancestors' backgrounds from the outermost (opaque, or white
 * when none is) inwards, each laid over the ones below, and each stop of a gradient over those.
 */
export function grounds(layers) {
  let out = [[255, 255, 255, 1]];
  for (const { color, stops } of layers) {
    const base = out.map((g) => over(color, g));
    out = [...base, ...stops.flatMap((stop) => base.map((g) => over(stop, g)))];
    out = out.filter((g, i) => out.findIndex((h) => h.every((v, j) => v === g[j])) === i);
  }
  return out;
}

const near = (a, b) => [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) <= 2);
const round1 = (n) => Math.round(n * 10) / 10;

/** The problems of a screen's text, one line each; none when it reads from across a hall. */
export function judge(samples, viewport, tokens) {
  const minPx = 0.025 * Math.min(viewport.width, viewport.height);
  const accents = Object.values(tokens);
  const problems = [];
  for (const s of samples) {
    const what = `"${s.text}" at ${s.where}`;
    if (s.clipped === true) problems.push(`${what}: cut off by the box around it`);
    if (s.fontPx < minPx - 0.05) {
      problems.push(`${what}: ${round1(s.fontPx)} px, under ${round1(minPx)} px`);
    }
    // A colour not read has no contrast to measure: the problem is that, not a guessed ratio.
    if (s.unread?.length) {
      for (const c of s.unread) problems.push(`${what}: cannot read the colour "${c}"`);
      continue;
    }
    const need = accents.some((t) => near(t, s.color)) ? 3 : 4.5;
    const worst = Math.min(...grounds(s.layers).map((g) => contrast(over(s.color, g), g)));
    if (worst < need) {
      problems.push(`${what}: contrast ${worst.toFixed(2)}:1, under ${need}:1`);
    }
  }
  return problems;
}

/** judge() of what collectSamples() answered in the page. */
export function judgePage(page) {
  const samples = page.samples.map((s) => {
    const values = [s.color, ...s.layers.flatMap((l) => [l.color, l.image])];
    return {
      ...s,
      color: readColor(s.color) ?? [0, 0, 0, 1],
      layers: s.layers.map((l) => ({
        color: readColor(l.color) ?? [0, 0, 0, 0],
        stops: /gradient/.test(l.image) ? parseColors(l.image) : [],
      })),
      unread: [
        ...(readColor(s.color) === null ? [s.color] : []),
        ...values.slice(1).flatMap(unreadColors),
      ],
    };
  });
  const problems = [];
  const tokens = {};
  for (const [k, v] of Object.entries(page.tokens)) {
    // An unset token is no accent; one set but not read is a problem of its own.
    if (v === "") continue;
    const c = readColor(v);
    if (c === null) problems.push(`the theme's ${k}: cannot read the colour "${v}"`);
    else tokens[k] = c;
  }
  return [...problems, ...judge(samples, page.viewport, tokens)];
}

/**
 * Runs in the page (Playwright's evaluate), so it uses nothing from outside: every element that
 * draws text of its own, with its size, colour and the backgrounds of it and its ancestors up to
 * the first opaque one. Text that is hidden, clipped away or off the screen is left out.
 */
export function collectSamples() {
  const vw = innerWidth;
  const vh = innerHeight;
  // Chrome writes a colour with alpha as rgba() or with a "/ alpha" part.
  const opaque = (c) => /^(rgb|color|oklab|oklch|lab|lch)\(/.test(c) && !c.includes("/");
  const where = (el) => {
    const parts = [];
    for (let n = el; n && n !== document.body && parts.length < 4; n = n.parentElement) {
      const cls = [...n.classList].filter((c) => c.startsWith("canccu-")).slice(0, 2);
      parts.unshift(n.tagName.toLowerCase() + cls.map((c) => `.${c}`).join(""));
    }
    return parts.join(" > ");
  };
  /** The part of the page an element's ancestors let it draw on. */
  const clipBox = (el) => {
    let box = { left: 0, top: 0, right: vw, bottom: vh };
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (getComputedStyle(n).overflow === "visible") continue;
      const c = n.getBoundingClientRect();
      box = {
        left: Math.max(box.left, c.left),
        top: Math.max(box.top, c.top),
        right: Math.min(box.right, c.right),
        bottom: Math.min(box.bottom, c.bottom),
      };
    }
    return box;
  };
  const shown = (r, box) =>
    r.width >= 1 &&
    r.height >= 1 &&
    r.right > box.left &&
    r.left < box.right &&
    r.bottom > box.top &&
    r.top < box.bottom;
  // Two pixels of slack, for boxes laid out at fractions of a pixel.
  const cut = (r, box) =>
    r.left < box.left - 2 ||
    r.top < box.top - 2 ||
    r.right > box.right + 2 ||
    r.bottom > box.bottom + 2;
  const moving = (el) => {
    // A stepping ticker (no motion) shows its wrapped text a line at a time, so the rest is cut
    // off by design, as a crawl's is (player/src/ticker.ts).
    if (el.closest(".canccu-widget__steps") !== null) return true;
    for (let n = el; n; n = n.parentElement) {
      const endless = n.getAnimations().some((a) => a.effect?.getTiming().iterations === Infinity);
      if (endless) return true;
    }
    return false;
  };
  const samples = [];
  for (const el of document.body.querySelectorAll("*")) {
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join("")
      .trim();
    if (own === "" || el.closest("svg, script, style")) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const rect = el.getBoundingClientRect();
    const box = clipBox(el);
    if (!shown(rect, box)) continue;
    const style = getComputedStyle(el);
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      layers.unshift({ color: s.backgroundColor, image: s.backgroundImage });
      if (opaque(s.backgroundColor)) break;
    }
    samples.push({
      text: own.slice(0, 60),
      where: where(el),
      fontPx: parseFloat(style.fontSize),
      clipped: cut(rect, box) && !moving(el),
      color: style.color,
      layers,
    });
  }
  const root = getComputedStyle(document.documentElement);
  const names = ["primary", "accent", "status-ok", "status-degraded", "status-down"];
  // A token is what its theme wrote, a var() or a named colour too: a probe's computed colour
  // resolves it as the browser does, so the judge reads what the text is drawn in.
  const probe = document.createElement("span");
  probe.hidden = true;
  document.documentElement.append(probe);
  const tokens = Object.fromEntries(
    names.map((k) => {
      if (root.getPropertyValue(`--canccu-color-${k}`).trim() === "") return [k, ""];
      probe.style.color = `var(--canccu-color-${k})`;
      return [k, getComputedStyle(probe).color];
    }),
  );
  probe.remove();
  return { samples, tokens, viewport: { width: vw, height: vh } };
}
