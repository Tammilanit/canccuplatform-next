/**
 * Pairing's strings (#190, #783), English first; messages.ts adds them to the catalogue. Every
 * error says what went wrong and what to do, in the organiser's words, never a code.
 */
export const PAIR_EN = {
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
  "pair.insecure": "This address can't pair screens: open it with https.",
  "pair.restricted":
    "This event lets screens play only on the venue's network: connect the screen there before you pair it.",
  "pair.error.code":
    "That code is wrong or has expired. Check the 8 characters on the screen: it shows a new code every 10 minutes.",
  "pair.error.format": "A code is the 8 letters and digits the screen shows.",
  "pair.error.no_venue":
    "This event has no venue yet, so it cannot pair screens. Ask the platform admin to set one.",
  "pair.error.zone": "That zone no longer exists. Choose another, or Choose later.",
  "pair.error.offline": "Your phone or computer is offline. Check its connection and pair again.",
  "paired.title": "Just paired",
  "paired.waiting": "Waiting for {device} to connect…",
  "paired.waiting_help": "The screen changes by itself within a few seconds.",
  "paired.on": "{device} is on.",
  "paired.on_help":
    "Show a test pattern to check its edges and size, or Identify to flash its name on it.",
  "paired.late": "{device} has not connected.",
  "paired.late_help":
    "Check that the screen is on and still shows its code. If it shows a new code, remove this screen and pair it again.",
  "paired.offline": "{device} is offline.",
  "paired.offline_help": "Check its power and its network. It comes back by itself.",
  "device.test_pattern": "Test pattern",
  "device.test_patterned": "Test pattern sent: it shows for 15 seconds.",
  "device.sent_offline":
    "Sent, but {device} is offline: it shows only if it is back within a minute.",
  "help.not_connected": "{device} has not connected since it was paired.",
  "help.not_connected.on": "Check that the screen is on and its browser still shows its code.",
  "help.not_connected.again": "If it shows a new code, remove this screen and pair it again.",
} as const;

/** The keys the Devices page's script shows (static/studio-devices.js). */
export const PAIR_CLIENT_KEYS = [
  "pair.done",
  "pair.error.code",
  "pair.error.format",
  "pair.error.no_venue",
  "pair.error.zone",
  "pair.error.offline",
] as const;
