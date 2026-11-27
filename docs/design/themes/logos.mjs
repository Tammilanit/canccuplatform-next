// The demo logo of each new preset (#785, PO review D12): a mark and a wordmark in the preset's own
// colours and heading font, so a fresh event shows an identity that fits the look, not the blue
// "Demo" button. The marks are inline SVG and CSS on the page's custom properties. The packages
// ship them as `images/logo.svg` with the wordmark's letters converted to outlines (Part 1 and 2).
const fill = (v) => `var(--canccu-color-${v})`;
const svg = (body, size = 88) => `<svg class="t-pack-mark" viewBox="0 0 88 88" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;

/** Eight-by-eight pixel gem, drawn in square cells (no game's art: a plain jewel). */
const GEM = ["..3333..", ".322223.", "32111123", "32111123", "32111123", ".321123.", "..3223..", "...33..."];
const gem = () =>
  svg(GEM.flatMap((row, y) => [...row].map((c, x) => (c === "." ? "" : `<rect x="${x * 11}" y="${y * 11}" width="11" height="11" fill="${c === "1" ? fill("primary") : c === "2" ? fill("accent") : fill("text")}"/>`))).join(""));

const MARKS = {
  esports: () => svg(`<polygon points="8,8 80,8 80,56 56,80 8,80" fill="${fill("primary")}"/><polygon points="20,20 68,20 68,50 50,68 20,68" fill="none" stroke="${fill("primary_text")}" stroke-width="6"/><rect x="32" y="32" width="14" height="24" fill="${fill("accent")}"/>`),
  synthwave: () => svg(`<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fill("accent")}"/><stop offset="1" stop-color="${fill("primary")}"/></linearGradient><mask id="sm"><rect width="88" height="88" fill="#fff"/><rect y="52" width="88" height="4" fill="#000"/><rect y="62" width="88" height="6" fill="#000"/><rect y="73" width="88" height="8" fill="#000"/></mask></defs><circle cx="44" cy="44" r="38" fill="url(#sg)" mask="url(#sm)"/>`),
  arcade: gem,
  "cozy-lan": () => svg(`<circle cx="44" cy="44" r="40" fill="${fill("primary")}"/><path d="M44 16c4 12 18 18 18 34a18 18 0 0 1-36 0c0-8 5-12 8-18 2 5 4 7 7 8-3-9-1-17 3-24z" fill="${fill("primary_text")}"/><path d="M44 46c2 6 8 8 8 15a8 8 0 0 1-16 0c0-4 3-6 4-9 2 3 3 3 4 4z" fill="${fill("accent")}"/>`),
  daylight: () => svg(`<g stroke="${fill("accent")}" stroke-width="6" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => `<line x1="44" y1="6" x2="44" y2="16" transform="rotate(${i * 45} 44 44)"/>`).join("")}</g><circle cx="44" cy="44" r="21" fill="${fill("primary")}"/>`),
};

const TAGLINE = {
  esports: ["DEMO LAN", "Main hall · live"],
  synthwave: ["DEMO LAN", "Saturday night · main hall"],
  arcade: ["DEMO LAN", "Insert coin"],
  "cozy-lan": ["Demo LAN", "Welcome in, grab a seat"],
  daylight: ["Demo LAN", "Open all day · main hall"],
};

/** The brand region's widget: the mark, the wordmark, and the tagline strip that fills the row. */
export function logo(preset) {
  const [word, tag] = TAGLINE[preset.id];
  return `<div class="t-pack-logo t-pack-logo--${preset.id}">${MARKS[preset.id]()}<span class="t-pack-word">${word}</span><span class="t-pack-tag">${tag}</span></div>`;
}
