/**
 * The strings of "Preview on a screen…" and the preview time (mockup 08; #444), English first;
 * messages.ts adds them to the catalogue.
 */
export const PREVIEW_EN = {
  "preview.at": "Preview time",
  "preview.at_now": "Now",
  "preview.at_hint": "What the zone would show then: its schedule and the run of show.",
  "preview.on_screen": "Preview on a screen…",
  "preview.dialog_title": "Preview this zone on a screen",
  "preview.screen": "Screen",
  "preview.for": "For",
  "preview.minutes": "{count} min",
  "preview.until_ended": "Until I end it",
  "preview.online": "online",
  "preview.offline": "offline · can't preview",
  "preview.no_screens": "No screen shows this zone yet. Assign one on Devices first.",
  "preview.hint":
    'Only that screen shows your unsaved change, with a "Preview" mark in its corner. Nothing is saved; it goes back to the live zone by itself.',
  "preview.cancel": "Cancel",
  "preview.start": "Start preview",
  "preview.pick": "Pick a screen that is online.",
  "preview.running": "Previewing on {device}",
  "preview.left": "Previewing on {device} · {time} left",
  "preview.running_text":
    "That screen shows your unsaved change. Every other screen shows the live zone.",
  "preview.end": "End preview",
} as const;

/** The keys the zone editor's script needs (static/studio-screen-preview.js). */
export const PREVIEW_CLIENT_KEYS = ["preview.pick", "preview.running", "preview.left"] as const;
