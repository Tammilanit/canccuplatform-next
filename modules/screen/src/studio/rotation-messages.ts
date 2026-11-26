/** The idle rotation's words in the zone editor (#787 D1, D3, D4; sheet 06). */
export const ROTATION_EN = {
  "widget.agenda_timeline": "The coming hours",
  "widget.leaderboard": "Standings",
  "zone.widget_on": "Plays in the rotation",
  "zone.hero_dwell": "Each item shows",
  "zone.hero_dwell_hint": "The layout's {seconds} s unless you pick another.",
  "zone.dwell_chip": "{seconds} s",
  "change.switched_off": "{region}: {widget} switched off",
  "change.switched_on": "{region}: {widget} switched on",
} as const;

export const ROTATION_CLIENT_KEYS = ["change.switched_off", "change.switched_on"] as const;
