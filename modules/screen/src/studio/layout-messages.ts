/**
 * Zones and layouts' strings (#405, sheet 10's lower frames), English first; messages.ts adds
 * them to the catalogue: the zone tabs, the layout gallery, the box editor and the hero role.
 */
export const LAYOUT_EN = {
  "zone.tabs": "Zones",
  "layout.title": "Layout",
  "layout.desc": "Pick one for this zone. The theme may add its own.",
  "layout.pick": "Use the layout {layout}",
  "layout.portrait": "9:16",
  "layout.discard": "Picking another layout drops the changes not yet live. Go on?",
  "boxes.title": "Boxes",
  "boxes.desc": "Click a box to change what it shows; drag a handle to resize it.",
  "boxes.desc_phone": "Tap a box to change what it shows or its size.",
  "boxes.hidden": "Hidden boxes",
  "boxes.kept": "Kept for another layout",
  "boxes.show": "Show {box}",
  "boxes.reset": "Reset to the built-in layout…",
  "boxes.reset_confirm": "Put every box back where the layout has it and show the hidden ones?",
  "boxes.handle": "Drag to resize {box}",
  "box.selected": "Selected box",
  "box.size": "Size",
  "box.narrower": "Narrower",
  "box.wider": "Wider",
  "box.shorter": "Shorter",
  "box.taller": "Taller",
  "box.size_hint": "Or drag a handle. Boxes snap to the {columns} × {rows} grid and never overlap.",
  "box.size_hint_phone": "Boxes snap to the {columns} × {rows} grid and never overlap.",
  "box.blocked": "No room there: another box or the edge of the screen is in the way.",
  "box.hide": "Hide this box",
  "box.hide_hint": "Its space goes to the boxes beside it.",
  "box.show_blocked": "Make room first: the box's place is taken.",
  "hero.title": "Which box is the hero?",
  "hero.overline": "{layout} · {zone}",
  "hero.role": "Hero",
  "hero.hint":
    "Click another box to give it the role. The hero box plays the Director's features, and grows to four cells when something is showcased.",
  "hero.grow": "Grow for a showcase",
  "hero.grow_hint":
    "A crew spotlight, a surging game or a called match. Off: the showcase plays in the box at its normal size.",
  "change.layout": "Layout: {from} → {to}",
  "change.size": "{box}: new size",
  "change.hidden": "{box}: hidden",
  "change.shown": "{box}: shown",
  "change.hero": "Hero role: {from} → {to}",
  "region.online": "Online",
  "region.voice": "In voice",
  "region.top_games": "Top games",
  "region.right_now": "Right now",
} as const;

/** The keys the page script words itself (static/studio-layout.js). */
export const LAYOUT_CLIENT_KEYS = [
  "layout.discard",
  "boxes.reset_confirm",
  "box.blocked",
  "box.show_blocked",
  "change.layout",
  "change.size",
  "change.hidden",
  "change.shown",
  "change.hero",
] as const;
