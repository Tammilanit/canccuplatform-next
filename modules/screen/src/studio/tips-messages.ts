/**
 * The Screen studio's page descriptions and chip tooltips (#782), English first; messages.ts adds
 * them to the catalogue.
 */
export const TIPS_EN = {
  "device.flag.clock_drift.tip":
    "Its clock is more than 2 seconds off, so its rotation and countdowns drift from the other screens.",
  "device.flag.shared_token.tip":
    "Two browsers show this screen at once: its cookie was copied to another kiosk, or two tabs are open.",
  "zone.about":
    "What this zone's screens show and when. A change reaches its screens when you save it.",
} as const;
