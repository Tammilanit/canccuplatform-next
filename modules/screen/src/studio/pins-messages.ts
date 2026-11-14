/**
 * The Pins page's strings and the frozen banner every page shows (#265), English first;
 * messages.ts adds them to the catalogue.
 */
export const PINS_EN = {
  "pins.desc":
    "The player bundle and theme revision every screen uses, and the freeze that holds them.",
  "pins.in_effect": "In effect",
  "pins.in_effect_desc": "What every screen of the event draws now.",
  "pins.bundle": "Bundle",
  "pins.theme": "Theme",
  "pins.bundle_value": "Bundle {version}",
  "pins.theme_value": "Theme revision {revision}",
  "pins.theme_none": "The built-in look: no theme is published yet",
  "pins.pinned": "Pinned",
  "pins.pinned_desc": "A pinned value holds while the platform or the theme moves on.",
  "pins.bundle_follows": "Follows the platform version",
  "pins.theme_follows": "Follows the published theme",
  "pins.until": "Until",
  "pins.no_end": "No end",
  "pins.afterwards": "Afterwards",
  "pins.changed": "Pinned by {name}, {time}",
  "pins.restored": "Put back by itself when the freeze ended, {time}",
  "pins.never": "Nothing has been pinned yet.",
  "pins.freeze_title": "Freeze for the event",
  "pins.freeze_desc":
    "Holds the bundle and theme revision screens draw now until the event ends, so no update or publish changes them. It ends by itself.",
  "pins.freeze": "Freeze for the event",
  "pins.freeze_confirm": "Tap again to freeze until {time}",
  "pins.freeze_until": "The event has no end time. Freeze until:",
  "pins.freeze_done": "Screens are frozen. Each reloads once to hold what it draws.",
  "pins.frozen_title": "Frozen",
  "pins.frozen_desc": "Unfreeze to put back what was pinned before the freeze.",
  "pins.unfreeze": "Unfreeze",
  "pins.unfreeze_confirm": "Tap again to unfreeze",
  "pins.unfreeze_done": "The freeze has ended.",
  "pins.no_right": "Only someone who may pin bundles can freeze the screens.",
  "frozen.title": "Screens are frozen",
  "frozen.banner":
    "Bundle {bundle} and theme revision {revision} are held until {time} (set by {name}).",
  "frozen.banner_bundle":
    "Bundle {bundle} is held until {time} (set by {name}). The theme still changes when one is published.",
  "frozen.banner_theme":
    "Theme revision {revision} is held until {time} (set by {name}). The bundle follows the platform.",
} as const;
