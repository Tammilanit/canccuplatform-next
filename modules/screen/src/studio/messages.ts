/**
 * Every Studio string, behind a message key (step 3 plan, U11): the event's language picks the
 * catalogue, English first. Finnish joins in step 10; until then, and for any language without a
 * catalogue, English is used, so a page never shows a bare key.
 */
import { CONTENT_EN } from "./content-messages.js";
import { PLAYLIST_CLIENT_KEYS, PLAYLIST_EN } from "./playlist-messages.js";
import { LAYOUT_CLIENT_KEYS, LAYOUT_EN } from "./layout-messages.js";
import { SCHEDULE_CLIENT_KEYS, SCHEDULE_EN } from "./schedule-messages.js";

const EN = {
  ...CONTENT_EN,
  ...SCHEDULE_EN,
  ...PLAYLIST_EN,
  ...LAYOUT_EN,
  "studio.title": "Screen studio",
  "studio.page": "the Screen studio",
  "studio.back": "Back to the Screen studio",
  "tab.live": "Live",
  "tab.devices": "Devices",
  "tab.zones": "Zones and layouts",
  "tab.ticker": "Ticker",

  "live.desc": "What every zone shows now. Tap a zone for its full view.",
  "live.screens": "{online} of {total} screens online",
  "live.screens.one": "{online} of 1 screen online",
  "live.no_screens": "No screens yet",
  "live.open": "Open {zone} full size",
  "live.quick": "Quick actions",
  "live.set_ticker": "Set the ticker",
  "live.pair": "Pair a screen",
  "live.empty_title": "No zones yet",
  "live.empty_text": "A zone is a group of screens that show the same thing. Add one in Zones.",

  "devices.desc": "Every screen of the event: what it shows, its health and what to do.",
  "devices.summary": "{total} screens · {online} online · {offline} offline",
  "devices.summary.one": "1 screen · {online} online · {offline} offline",
  "devices.bundle": "all on bundle {version}",
  "devices.bundles": "bundles {versions}",
  "devices.recent": "Recent",
  "devices.recent_desc": "Pairings and screens going offline, newest first.",
  "devices.recent_none": "Nothing has happened yet.",
  "recent.paired": "{device} paired",
  "recent.offline": "{device} went offline",
  "devices.pair": "Pair a screen",
  "devices.clear_codes": "Clear open codes",
  "devices.clear_codes_confirm":
    "Clear every open pairing code? Screens waiting to pair show a new code.",
  "devices.cleared": "Open pairing codes cleared.",
  "devices.empty_title": "No screens yet",
  "devices.empty_text":
    "Open the start address on the screen's browser at the venue, then pair it here with the code it shows.",
  "devices.uplink_title": "The venue uplink may be down",
  "devices.uplink_text":
    "Every screen went offline within one minute. Check the venue's internet connection first; the screens catch up by themselves when it is back.",
  "device.zone": "{zone}",
  "device.mirrors_device": "mirrors {device}",
  "device.mirrors_zone": "mirrors zone {zone}",
  "device.unassigned": "no zone",
  "device.paired": "paired {ago}",
  "device.sound": "sound on",
  "device.sound_off": "sound off",
  "device.silent": "silent",
  "device.portrait": "portrait {size}",
  "device.not_assigned": "not assigned",
  "device.now_name": "Now: its name, “not assigned”",
  "device.last": "Last: {what}",
  "device.up_to_date": "state up to date",
  "device.offline_for": "offline since {time}",
  "device.online": "Online",
  "device.offline": "Offline",
  "device.seen": "seen {ago}",
  "device.never_seen": "Not seen yet",
  "device.now": "Now: {what}",
  "device.now_countdown": "{label} countdown",
  "device.now_logo": "the event's logo",
  "device.behind": "{count} changes behind",
  "device.behind.one": "1 change behind",
  "device.flag.clock_drift": "Clock off",
  "device.flag.shared_token": "Cookie copied",
  "device.identify": "Identify",
  "device.identified": "The screen shows its name for a few seconds.",
  "device.reload": "Reload",
  "device.reloaded": "The screen reloads now.",
  "device.edit": "Assign",
  "device.assign": "Assign to a zone",
  "device.name": "Name",
  "device.shows": "Shows",
  "device.shows_none": "Nothing (not assigned)",
  "device.shows_zone": "Zone: {zone}",
  "device.shows_mirror": "Same as {device}",
  "device.save": "Save",
  "device.saved": "Saved.",
  "device.revoke": "Remove from the event",
  "device.revoke_confirm":
    "Remove {device}? It goes back to its pairing code and must be paired again.",
  "device.preview": "Live view of {device}",
  "help.title": "What to check",
  "help.offline": "{device} is offline since {since}. It keeps showing its last state.",
  "help.offline.power": "Is the TV on, and the computer awake?",
  "help.offline.network": "Is its network cable or Wi-Fi up?",
  "help.offline.uplink_fine": "Other screens are online, so the venue uplink is fine.",
  "help.offline.uplink_down": "No screen is online: check the venue's internet connection first.",
  "help.offline.refused":
    "Does it say it is not at the venue? The venue's address changed: ask the platform admin to update it, or turn off the venue check for a while in the event's settings.",
  "help.offline.restart": "Still dark? Open the start address again: {url}",
  "help.offline.restart_plain": "Still dark? Open the screen's start address again.",
  "help.offline.catches_up": "When it is back it catches up by itself: no reload needed.",
  "help.clock_drift": "Its clock is wrong, so timed things show at the wrong moment.",
  "help.clock_drift.fix": "Set the computer's clock to set itself from the internet, then reload.",
  "help.shared_token": "Two browsers use this screen's cookie.",
  "help.shared_token.fix":
    "Close the other browser. If you do not know where it is, remove this screen and pair it again.",
  "help.behind": "It has not taken the zone's latest changes.",
  "help.behind.fix": "Reload it. If it stays behind, check its network.",
  "help.unassigned": "It shows only its name.",
  "help.unassigned.fix": "Choose a zone for it with Assign to a zone.",

  "pair.title": "Pair a screen",
  "pair.code": "Code",
  "pair.code_hint": "The 8 characters the screen shows.",
  "pair.name": "Name",
  "pair.name_hint": "Where it is, such as Hall left.",
  "pair.zone": "Zone",
  "pair.no_zone": "Choose later",
  "pair.submit": "Pair",
  "pair.cancel": "Cancel",
  "pair.done": "{device} is paired.",

  "zones.desc": "Each zone is a group of screens that show the same thing.",
  "zones.screens": "{count} screens",
  "zones.screens.one": "1 screen",
  "zones.layout": "Layout {layout}",
  "zones.theme_layout": "Theme's layout",
  "zones.new": "New zone",
  "zones.new_name": "Name",
  "zones.new_key": "Key",
  "zones.new_key_hint":
    "2 to 32 lowercase letters, digits, - or _. The run of show names the zone with it.",
  "zones.add": "Add zone",
  "zones.empty_title": "No zones yet",
  "zones.empty_text": "Add a zone, then assign screens to it in Devices.",

  "zone.back": "All zones",
  "zone.name": "Name",
  "zone.header": "Header",
  "zone.header_default": "As the layout says",
  "zone.header.separate": "Its own row",
  "zone.header.shared": "Shared with the hero",
  "zone.hub_qr": "Hub QR",
  "zone.hub_qr.always": "Always shown",
  "zone.hub_qr.rotate": "Takes turns with the venue rail",
  "zone.sound": "Sound",
  "zone.sound_on": "Play sound",
  "zone.sound_device": "Sound from",
  "zone.sound_auto": "The first screen of the zone",
  "zone.region": "Region: {region}",
  "zone.region_layout": "From the layout",
  "zone.region_own": "Set for this zone",
  "zone.region_empty": "Nothing",
  "zone.widget_dwell": "{seconds} s",
  "zone.handle": "Drag to reorder",
  "zone.layout_widgets": "Use the layout's widgets",
  "zone.widgets": "Widgets, in order",
  "zone.add_widget": "Add widget",
  "zone.up": "Up",
  "zone.down": "Down",
  "zone.remove": "Remove",
  "zone.rotation": "Rotation",
  "zone.rotation.sequence": "In order",
  "zone.rotation.shuffle": "Shuffle",
  "zone.dwell": "Seconds each",
  "zone.dwell_hint": "Empty: the layout's {seconds} s.",
  "zone.skip_empty": "Skip empty widgets",
  "zone.idle": "When all are empty",
  "zone.idle.logo": "Show the logo",
  "zone.idle.blank": "Show nothing",
  "zone.idle.collapse": "Hide the region",
  "zone.idle.next": "Count down to the next item",
  "zone.preview": "Preview",
  "zone.preview_title": "Preview: what its screens would show",
  "zone.preview_hint": "The real player with the event's data. Nothing is saved.",
  "zone.save": "Go live",
  "zone.save_none": "Go live (no screens show it yet)",
  "zone.save_on": "Go live on {count} screens",
  "zone.save_on.one": "Go live on 1 screen",
  "zone.changes": "Changes",
  "zone.discard": "Discard",
  "change.none": "Nothing changed yet.",
  "change.field": "{what}: {from} → {to}",
  "change.added": "{region}: {widget} added",
  "change.removed": "{region}: {widget} removed",
  "change.order": "{region}: new order",
  "change.on": "on",
  "change.off": "off",
  "change.default": "default",
  "zone.saved": "Live on the zone's screens.",
  "zone.undo": "Undo",
  "zone.undone": "The earlier version is back.",
  "zone.undo_hint": "Undo stays available for 10 minutes after going live.",
  "zone.conflict": "Someone else changed this zone. Reload to see their change, then edit again.",
  "zone.reload": "Reload",
  "zone.delete": "Delete zone",
  "zone.delete_confirm": "Delete the zone {zone}?",

  "ticker.desc": "One calm line across the bottom of every screen.",
  "ticker.showing": "Showing: {text}",
  "ticker.nothing": "Nothing shows now.",
  "ticker.from.admin": "Set in Studio",
  "ticker.from.bot": "Set from Discord",
  "ticker.from.window": "From a scheduled line",
  "ticker.until": "until {time}",
  "ticker.no_end": "no end",
  "ticker.text": "Line",
  "ticker.chars": "{count} of 280 characters",
  "ticker.for": "Until",
  "ticker.15m": "15 min",
  "ticker.1h": "1 h",
  "ticker.4h": "4 h",
  "ticker.at": "At a time",
  "ticker.forever": "No end",
  "ticker.set": "Show on every screen",
  "ticker.set_done": "The ticker shows the new line.",
  "ticker.clear": "Clear",
  "ticker.clear_done": "The ticker line is cleared.",

  "widget.playlist": "Playlist",
  "widget.photo": "Photo",
  "widget.agenda_now": "Now and next",
  "widget.countdown": "Countdown",
  "widget.clock": "Clock",
  "widget.logo": "Logo",
  "widget.qr": "QR code",
  "widget.venue_info": "Venue info",
  "widget.checkin_qr": "Check-in QR",
  "widget.ticker": "Ticker",
  "widget.hot_game": "Hot game",
  "widget.bracket": "Bracket",
  "widget.food_status": "Food status",
  "widget.embed": "Theme embed",
  "region.header": "Header",
  "region.hero": "Hero",
  "region.rail": "Side rail",
  "region.venue_rail": "Venue card",
  "region.ticker": "Ticker",

  "ago.now": "just now",
  "ago.s": "{n} s ago",
  "ago.min": "{n} min ago",
  "ago.h": "{n} h ago",
  "error.failed": "That did not work. Try again.",
  "error.refused": "Couldn't do that: {message}",
} as const;

export type MessageKey = keyof typeof EN;
type Catalogue = Record<MessageKey, string>;

const CATALOGUES: Record<string, Catalogue> = { en: EN };

/** The event's `admin.language`, or English for a language without a catalogue yet. */
export function languageOf(value: unknown): string {
  return typeof value === "string" && Object.hasOwn(CATALOGUES, value) ? value : "en";
}

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** `t(key, values)` for `language`: `{name}` in the message takes `values.name`. */
export function translator(language: string): Translate {
  const catalogue = CATALOGUES[languageOf(language)] ?? EN;
  return (key, values = {}) =>
    catalogue[key].replace(/\{([a-z_]+)\}/g, (whole, name: string) =>
      Object.hasOwn(values, name) ? String(values[name]) : whole,
    );
}

/** Text for people from a key without a message: `food_status` reads "Food status". */
export function readable(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A widget's or region's name in words: its message, or the key made readable for one the
 * catalogue does not know (a theme's own region), so a page never shows a raw key.
 */
export function nameOf(t: Translate, kind: "widget" | "region", key: string): string {
  const id = `${kind}.${key}`;
  return Object.hasOwn(EN, id) ? t(id as MessageKey) : readable(key);
}

/** `key.one` for one, `key` otherwise, when the catalogue has both. */
export function counted(
  t: Translate,
  key: MessageKey,
  count: number,
  values: Record<string, string | number> = {},
): string {
  const one = `${key}.one`;
  const id = count === 1 && Object.hasOwn(EN, one) ? (one as MessageKey) : key;
  return t(id, { count, ...values });
}

/** The keys the page script needs, in the page's language, for the JSON block it reads. */
export const CLIENT_KEYS = [
  "device.identified",
  "device.reloaded",
  "device.saved",
  "devices.cleared",
  "pair.done",
  "zone.saved",
  "zone.undo",
  "zone.undone",
  "zone.conflict",
  "zone.reload",
  "change.none",
  "change.field",
  "change.added",
  "change.removed",
  "change.order",
  "change.on",
  "change.off",
  "change.default",
  "zone.widget_dwell",
  "ticker.set_done",
  "ticker.clear_done",
  "ticker.chars",
  "error.failed",
  "error.refused",
  "storage.used",
  "size.b",
  "size.kb",
  "size.mb",
  "size.gb",
  "upload.progress",
  "upload.waiting",
  "upload.sending",
  "upload.checking",
  "upload.added",
  "upload.replaced",
  "upload.refused",
  "upload.too_large",
  "upload.quota",
  "upload.failed",
  "upload.summary",
  "upload.all_done",
  "upload.all_done.one",
  "upload.show",
  "upload.same_name",
  "upload.keep",
  "upload.replace",
  "upload.pick",
  "upload.pick_one",
  "upload.replace_all",
  "upload.reason_batch",
  "upload.reason_kind",
  "upload.only_one_used",
  "upload.start",
  "upload.cancel",
  "link.added",
  "asset.replacing",
  "asset.replaced",
  "sound.play",
  "sound.stop",
  ...PLAYLIST_CLIENT_KEYS,
  ...LAYOUT_CLIENT_KEYS,
  ...SCHEDULE_CLIENT_KEYS,
] as const satisfies readonly MessageKey[];
