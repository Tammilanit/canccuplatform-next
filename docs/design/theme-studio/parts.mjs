// Drawing parts the sheets share (#784): the organiser shell around the studio, the preview
// column (screen, phone, hub page), the scaled previews themselves, logos on plates and the
// gallery's thumbnails. Every colour comes from a scheme of data.mjs, so a sheet shows the
// presets as they are. Markup uses packages/ui's classes, so the shell is the shipped one.
import { PLATES } from "./data.mjs";

export const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
export const icon = (name) => `<span class="canccu-i canccu-i--${name}" aria-hidden="true"></span>`;

/** The demo event's logo as an organiser might upload it: black on transparent (plan D20). */
export const LOGO_BLACK = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 64"><g fill="none" stroke="#000" stroke-width="6" stroke-linejoin="round"><path d="M32 5 56 19v26L32 59 8 45V19z"/><path d="M22 24h10a8 8 0 0 1 0 16H22z"/></g><text x="70" y="30" font-family="Arial, sans-serif" font-weight="800" font-size="24" fill="#000">DEMO</text><text x="70" y="56" font-family="Arial, sans-serif" font-weight="800" font-size="24" fill="#000">EVENT</text></svg>`,
)}`;

/** The variables a theme's tokens set, scoped to one preview (contracts/theming.md, custom properties). */
export function vars(k, o = {}) {
  const v = Object.entries(k).map(([n, x]) => `--canccu-color-${n.replace("_", "-")}:${x}`);
  if (o.fonts) v.push(`--canccu-font-heading:"${o.fonts.heading}",system-ui,sans-serif`, `--canccu-font-body:"${o.fonts.body}",system-ui,sans-serif`);
  if (o.radius !== undefined) v.push(`--canccu-radius:${o.radius}px`);
  return v.join(";");
}

/** The plate's colour for a scheme (D4): light, dark, the theme's surface, or none. */
export const plateColor = (plate, k) => (plate === "light" ? PLATES.light : plate === "dark" ? PLATES.dark : plate === "surface" ? k.surface : "transparent");

/** A logo on its plate; `h` is the logo's drawn height, padding a factor of it (D4). */
export function logo(k, { plate = "none", shape = "rounded", pad = 0.15, h = 32, src = LOGO_BLACK } = {}) {
  const p = plate === "none" ? 0 : Math.round(h * pad);
  const radius = shape === "circle" ? "999px" : "calc(var(--canccu-radius, 8px) * 0.75)";
  const w = shape === "circle" ? `width:${h + 2 * p}px;height:${h + 2 * p}px;` : "";
  return `<span class="plate" style="background:${plateColor(plate, k)};padding:${p}px;border-radius:${radius};${w}"><img src="${src}" alt="" style="height:${shape === "circle" ? h * 0.6 : h}px"></span>`;
}

/** Stage backgrounds (D8) as a CSS background over the scheme's own. */
function stage(k, backdrop) {
  if (backdrop === "gradient") return `background:linear-gradient(135deg, ${k.primary}55, ${k.background} 45%, ${k.background} 60%, ${k.accent}55)`;
  if (backdrop === "image") return `background:linear-gradient(${k.background}cc, ${k.background}cc), repeating-linear-gradient(115deg, ${k.accent}66 0 30px, ${k.primary}55 30px 70px, ${k.surface} 70px 130px)`;
  if (backdrop === "art") return `background:linear-gradient(${k.background}bb, ${k.background}dd), radial-gradient(circle at 30% 40%, #8a4bd9, #1b3a6b 50%, #0b0d1a)`;
  return `background:radial-gradient(circle at 18% 22%, ${k.primary}33, transparent 42%), radial-gradient(circle at 85% 80%, ${k.accent}2e, transparent 45%), ${k.background}`;
}

/** The hall screen at 960×540 design units, scaled to `width`: header, hero, rail, venue rail, ticker. */
export function screen(k, o = {}) {
  const width = o.width ?? 480;
  const s = width / 960;
  const head = o.fonts?.heading ? `"${o.fonts.heading}",system-ui` : "system-ui";
  const body = o.fonts?.body ? `"${o.fonts.body}",system-ui` : "system-ui";
  const r = o.radius ?? 8;
  return `<div class="frame" style="width:${width}px;height:${Math.round(540 * s)}px"><div class="scr" style="transform:scale(${s});${stage(k, o.backdrop)};color:${k.text};font-family:${body}">
  <div class="scr__head">${logo(k, { ...o.logo, h: 34 })}<b style="font-family:${head}">Demo Event</b><span class="scr__clock" style="font-family:${head}">19:42</span></div>
  <div class="scr__hero" style="background:${k.surface}e6;border:2px solid ${k.border};border-radius:${r * 1.5}px">
    <p class="kick" style="color:${k.primary}">Next up</p><p class="big" style="font-family:${head}">Tournament final</p>
    <p class="count" style="font-family:${head};color:${k.primary}">12:30</p><p class="muted" style="color:${k.text_muted}">Main hall · starts at 20:00</p></div>
  <div class="scr__rail" style="background:${k.surface}e6;border:2px solid ${k.border};border-radius:${r * 1.5}px"><p class="kick" style="color:${k.accent}">Now</p><p class="mid" style="font-family:${head}">Dinner</p><p class="muted" style="color:${k.text_muted}">Café · until 20:00</p></div>
  <div class="scr__venue" style="background:${k.surface}e6;border:2px solid ${k.border};border-radius:${r * 1.5}px"><span class="qr" style="background-color:${k.text}"></span><span><b>The hub</b><br><span style="color:${k.text_muted}">Schedule, food and results</span></span></div>
  <div class="scr__ticker" style="background:${k.surface};border-top:2px solid ${k.border}"><span class="tag" style="background:${k.primary};color:${k.primary_text}">Info</span>Doors to the main hall open at 19:50</div>
</div></div>`;
}

/** The hub's home on a phone (390 px design width), scaled to `width`. */
export function phone(k, o = {}) {
  const width = o.width ?? 150;
  const s = width / 390;
  const head = o.fonts?.heading ? `"${o.fonts.heading}",system-ui` : "system-ui";
  const r = o.radius ?? 8;
  const card = (t, d, c) => `<div class="ph__card" style="background:${k.surface};border:1px solid ${k.border};border-radius:${r}px"><b style="font-family:${head}">${t}</b><span style="color:${c ?? k.text_muted}">${d}</span></div>`;
  return `<div class="frame frame--phone" style="width:${width}px;height:${Math.round(844 * s)}px"><div class="ph" style="transform:scale(${s});background:${k.background};color:${k.text};font-family:${o.fonts?.body ? `"${o.fonts.body}",system-ui` : "system-ui"}">
  <div class="ph__head" style="background:${k.surface};border-bottom:1px solid ${k.border}">${logo(k, { ...o.logo, h: 30 })}<b>Demo Event</b></div>
  <div class="ph__hero"><p style="color:${k.primary}" class="kick">Now</p><p class="big" style="font-family:${head}">Dinner</p><p style="color:${k.text_muted}">Café · until 20:00</p>
  <span class="ph__btn" style="background:${k.primary};color:${k.primary_text};border-radius:${r}px">Order pizza</span></div>
  ${card("Tournament final", "Main hall · 20:00")}${card("Pizza", "Orders open until 19:55", k.status_ok)}${card("Schedule", "6 more today")}
  <div class="ph__bar" style="background:${k.surface};border-top:1px solid ${k.border}"><span style="color:${k.primary}">Home</span><span>Schedule</span><span>Food</span><span>Me</span></div>
</div></div>`;
}

/** A hub page at desktop width (1280 design units), scaled to `width`. */
export function hubPage(k, o = {}) {
  const width = o.width ?? 330;
  const s = width / 1280;
  const head = o.fonts?.heading ? `"${o.fonts.heading}",system-ui` : "system-ui";
  const r = o.radius ?? 8;
  const tile = (t, d) => `<div class="hp__tile" style="background:${k.surface};border:1px solid ${k.border};border-radius:${r}px"><b style="font-family:${head}">${t}</b><span style="color:${k.text_muted}">${d}</span></div>`;
  return `<div class="frame" style="width:${width}px;height:${Math.round(800 * s)}px"><div class="hp" style="transform:scale(${s});background:${k.background};color:${k.text};font-family:${o.fonts?.body ? `"${o.fonts.body}",system-ui` : "system-ui"}">
  <div class="hp__head" style="background:${k.surface};border-bottom:1px solid ${k.border}">${logo(k, { ...o.logo, h: 40 })}<b>Demo Event</b><span style="color:${k.primary}">Home</span><span>Schedule</span><span>Food</span><span>Tournament</span></div>
  <div class="hp__body"><div class="hp__hero"><p class="kick" style="color:${k.primary}">Now</p><p class="big" style="font-family:${head}">Dinner</p><p style="color:${k.text_muted}">Café · until 20:00 · then the tournament final in the main hall</p>
  <span class="ph__btn" style="background:${k.primary};color:${k.primary_text};border-radius:${r}px">Order pizza</span></div>
  <div class="hp__grid">${tile("Tournament final", "Main hall · 20:00")}${tile("Pizza", "Orders open until 19:55")}${tile("Schedule", "6 more today")}${tile("Photos", "128 shared so far")}</div></div>
</div></div>`;
}

/** The preview column of plan D2: the screen on top, the phone and a hub page side by side. */
export function previewColumn(k, o = {}) {
  const w = o.width ?? 500;
  if (o.phone)
    // A phone (D2): the preview first, one frame at a time behind a switch.
    return `<aside class="pv" style="width:${w}px"><div class="row">${["Screen", "Phone", "Hub page"].map((t, i) => `<button class="pill" type="button" aria-pressed="${i === 0}">${t}</button>`).join("")}</div>
  <figure>${screen(k, { ...o, width: w })}<figcaption>Screen · Main hall · tap to open full size</figcaption></figure></aside>`;
  const phoneW = Math.round(w * 0.3);
  const hubW = w - phoneW - 16;
  return `<aside class="pv" style="width:${w}px">
  <div class="pv__head"><span class="canccu-overline">Live preview</span><span class="pv__state">${icon("check")}Shows your changes as you make them</span></div>
  <figure>${screen(k, { ...o, width: w })}<figcaption>Screen · Main hall</figcaption></figure>
  <div class="pv__row"><figure>${phone(k, { ...o, width: phoneW })}<figcaption>Phone</figcaption></figure><figure>${hubPage(k, { ...o, width: hubW })}<figcaption>Hub page</figcaption></figure></div>
  <div class="pv__foot"><a class="canccu-button canccu-button--secondary" href="#">${icon("monitor")}Preview on a screen</a></div>
</aside>`;
}

/** A gallery thumbnail (D12): a mini screen with the logo on its plate and "Aa" in the heading font. */
export function thumb(preset, scheme, o = {}) {
  const k = scheme.colors;
  const w = o.width ?? 200;
  const font = preset.fonts.heading === "system-ui" ? "system-ui" : `'${preset.fonts.heading}'`;
  const r = Math.min(preset.radius, 14) / 2;
  const svg = `<svg class="thumb__svg" viewBox="0 0 160 90" width="${w}" height="${Math.round((w * 9) / 16)}" role="img" aria-label="${esc(`${preset.name}, ${scheme.name}`)}">
  <defs><radialGradient id="g-${preset.id}-${scheme.id}" cx="20%" cy="20%" r="60%"><stop offset="0" stop-color="${k.primary}" stop-opacity=".35"/><stop offset="1" stop-color="${k.primary}" stop-opacity="0"/></radialGradient></defs>
  <rect width="160" height="90" fill="${k.background}"/><rect width="160" height="90" fill="url(#g-${preset.id}-${scheme.id})"/>
  <rect x="6" y="5" width="22" height="9" rx="2" fill="${plateColor(o.plate ?? "none", k)}"/><image href="${LOGO_BLACK}" x="7" y="6" width="20" height="7"/>
  <rect x="6" y="18" width="96" height="58" rx="${r}" fill="${k.surface}" stroke="${k.border}"/><text x="14" y="44" font-family="${font}" font-weight="700" font-size="18" fill="${k.text}">Aa</text>
  <rect x="14" y="54" width="44" height="5" rx="2" fill="${k.primary}"/><rect x="14" y="63" width="62" height="3" rx="1.5" fill="${k.text_muted}"/>
  <rect x="108" y="18" width="46" height="28" rx="${r}" fill="${k.surface}" stroke="${k.border}"/><rect x="114" y="26" width="22" height="4" rx="2" fill="${k.accent}"/><rect x="114" y="34" width="32" height="3" rx="1.5" fill="${k.text_muted}"/>
  <rect x="108" y="50" width="46" height="26" rx="${r}" fill="${k.surface}" stroke="${k.border}"/><rect x="0" y="80" width="160" height="10" fill="${k.surface}"/><rect x="6" y="82" width="14" height="6" rx="1" fill="${k.primary}"/><rect x="24" y="84" width="60" height="2.5" fill="${k.text_muted}"/>
</svg>`;
  return `<button class="thumb${o.chosen ? " thumb--chosen" : ""}" type="button">${svg}<span class="thumb__name">${esc(scheme.name)}${o.chosen ? ` ${icon("check")}` : ""}</span>${scheme.kind === "contrast" ? "" : `<span class="thumb__kind">${{ dark: "Dark", light: "Light", accent: "Colour variant" }[scheme.kind]}</span>`}</button>`;
}

const MENU = [
  ["Run the event", [["Run of show", "calendar"], ["Notifications", "bell"], ["Announcements", "megaphone"], ["Food", "food"]]],
  ["Screens and look", [["Screen studio", "monitor"], ["Theme studio", "palette", true]]],
  ["Admin", [["Settings", "sliders"], ["Health", "pulse"], ["Event profile", "box"], ["People", "users"], ["Integrations", "lock"]]],
];

/** The organiser shell around a studio page: header, the Event menu, the page head and the depth tabs. */
export function shell({ tab, body, status = "Saved", k }) {
  const menu = MENU.map(([label, items]) => `<div class="canccu-menu__group"><p class="canccu-overline canccu-menu__label">${label}</p>${items
    .map(([t, i, cur]) => `<a class="canccu-menu__item" href="#"${cur ? ' aria-current="page"' : ""}>${icon(i)}${t}</a>`)
    .join("")}</div>`).join("") + `<div class="canccu-menu__foot"><div class="canccu-user"><span class="canccu-avatar" aria-hidden="true">AO</span>Alex Organiser</div></div>`;
  // On a phone the shell's tabs show two and fold the rest under "more": this one and a neighbour.
  const shown = new Set([tab, tab === "Make it yours" ? "Pick a look" : "Make it yours"]);
  const tabs = ["Pick a look", "Make it yours", "Advanced", "History"]
    .map((t) => `<a class="canccu-tabs__item${shown.has(t) ? "" : " canccu-tabs__extra"}" href="#"${t === tab ? ' aria-current="page"' : ""}>${t}</a>`).join("") +
    `<button class="canccu-tabs__more" type="button">2 more</button>`;
  return `<div class="canccu-shell">
<header class="canccu-header">${logo(k, { plate: "light", h: 22, pad: 0.2 })}<span class="canccu-header__title">Demo Event</span><span class="canccu-header__sep"></span><span class="canccu-header__meta">Sat 14 – Sun 15 March</span><span class="canccu-badge canccu-badge--ok">Live</span><span class="canccu-header__end"></span></header>
<nav class="canccu-menu" aria-label="Event">${menu}</nav>
<nav class="canccu-tabbar" aria-label="Shortcuts"><a class="canccu-tabbar__item" href="#">${icon("calendar")}Run of show</a><a class="canccu-tabbar__item" href="#">${icon("food")}Food</a><a class="canccu-tabbar__item" href="#">${icon("monitor")}Screens</a><a class="canccu-tabbar__item" href="#" aria-current="page">${icon("palette")}Theme</a><button class="canccu-tabbar__item" type="button">${icon("more")}More</button></nav>
<div class="canccu-content"><main class="canccu-main canccu-main--wide">
<div class="canccu-pagehead"><div><h1 class="canccu-pagehead__title">Theme studio</h1><p class="canccu-pagehead__desc">How your screens, the hub and the organiser pages look. Changes stay a draft until you publish.</p></div>
<div class="canccu-cluster"><span class="savestate">${icon(status === "Saved" ? "check" : "clock")}${status}</span><a class="canccu-button canccu-button--secondary" href="#">${icon("download")}Export</a><a class="canccu-button canccu-button--secondary" href="#"><span class="canccu-i canccu-i--download up" aria-hidden="true"></span>Import</a><a class="canccu-button canccu-button--primary" href="#">Publish</a></div></div>
<nav class="canccu-tabs" aria-label="Theme studio">${tabs}</nav>
${body}
</main></div></div>`;
}
