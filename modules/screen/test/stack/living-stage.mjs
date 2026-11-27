// The living stage's strips (#787 D10–D13; sheets 03 and 04), handed to the main zone's Pulse as
// living.mjs hands its own: the background over a day (morning, the evening's peak, late night)
// and the hype low and high. Each frame is its own state, the page reloaded for it: the time of
// day comes from the event's time zone, handed so that its clock reads the frame's hour now.
import { keyArt } from "./handed.mjs";

/** The game's art as the server sends it, blurred; the demo cover stands in (handed-stage.mjs). */
const blurred = keyArt(18);

export const STAGE_FRAMES = {
  "living-day": [
    { hour: 8, part: "morning", look: "glows", level: "calm", hype: { level: 0.1, phase: "quiet" } },
    { hour: 21, part: "day", look: "particles", level: "party", hype: { level: 1, phase: "live" }, game: true },
    { hour: 1, part: "late", look: "waves", level: "calm", hype: { level: 0, phase: "quiet" } },
  ],
  "living-hype": [
    { hour: 18, part: "day", look: "particles", level: "calm", hype: { level: 0.1, phase: "quiet" } },
    { hour: 22, part: "day", look: "particles", level: "party", hype: { level: 1, phase: "live" }, game: true },
  ],
}; // prettier-ignore

/** The frame the next state is handed for; each strip starts at its first. */
let frame = 0;

/** An `Etc/GMT` zone whose clock reads `hour` now (its sign is the offset's reverse). */
function zoneAt(hour) {
  const d = (((hour - new Date().getUTCHours()) % 24) + 24) % 24;
  const offset = d > 14 ? d - 24 : d;
  return offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}

export function withStageLife(view) {
  frame = 0;
  return (s) => {
    const f = STAGE_FRAMES[view][frame];
    const stage = s.display?.stage ?? { phase: "build_up", kind: null, tint: null };
    return {
      ...s,
      tenant: { ...s.tenant, time_zone: zoneAt(f.hour) },
      // One look a frame: a look with no cycle, so the frame shows the one it is named for.
      theme: { ...s.theme, backdrop: { looks: [f.look], game_art: true, daylight: true, hype: true } },
      display: {
        ...s.display,
        motion_level: f.level,
        hype: { ...f.hype, item: null },
        stage: { ...stage, game: f.game ? { url: blurred, scrim: 0.7 } : null },
      },
    }; // prettier-ignore
  };
}

/** Each frame once its look, time of day and hype are drawn and the game's art has faded in. */
export async function stageStrip(page, view, shoot) {
  for (const [i, f] of STAGE_FRAMES[view].entries()) {
    frame = i;
    if (i > 0) await page.reload();
    const want = `.canccu-stage--look-${f.look}.canccu-stage--daylight-${f.part}.canccu-stage--hype-${f.hype.phase}`;
    await page.waitForSelector(`.canccu-stage${want}${f.game ? ".canccu-stage--game" : ""}`, {
      state: "attached",
    });
    await page.evaluate(() => document.fonts.ready);
    // The daylight's 2 s and the game art's 3 s fades.
    await page.waitForTimeout(3500);
    await shoot(`f${i + 1}`);
  }
}
