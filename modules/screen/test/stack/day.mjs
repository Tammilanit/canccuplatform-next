// Where the demo fixture's run of show sits (#400): a day around now with one item running and one
// delayed, on the event's date whatever the hour the run starts, and two items the next day, so the
// day view's switch has two days. The day view sorts an item by the date of its start in the
// event's zone, which for the demo event is UTC (events/demo/profile.yaml).

const MIN = 60_000;
const DAY = 24 * 60;
/**
 * Title, kind, start and end in minutes from the quarter hour before now, place, delay. The
 * running Dinner's delay moves only its end, which the day view shows as its slip, so the day
 * always has a delayed row; the semis, delayed before it starts, also shows its planned time.
 */
const TODAY = [
  ["Doors open", "doors", -240, -180, "Entrance", 0],
  ["Opening ceremony", "activity", -180, -150, "Stage", 0],
  ["Demo Game Cup, group stage", "tournament", -150, -45, "Stage", 0],
  ["Dinner", "meal", -30, 45, "Café", 10],
  ["Demo Game Cup, semis", "tournament", 60, 150, "Stage", 15],
  ["Board games corner", "activity", 90, 180, "Café", 0],
  ["Pub quiz", "activity", 150, 210, "Café", 0],
  ["Demo Game Cup, grand final", "tournament", 180, 270, "Stage", 0],
];
/** The next day's, in minutes from its midnight. */
const TOMORROW = [
  ["Breakfast", "meal", 8 * 60, 9 * 60 + 30, "Café", 0],
  ["Demo Game Cup, awards", "activity", 11 * 60, 11 * 60 + 30, "Stage", 0],
];
// The room TODAY takes either side of the quarter hour: back to its first start, on to its last.
const BEFORE = 240;
const AHEAD = 180;

/**
 * The fixture's items with their times for a run at `now` (ms). Near either end of the day TODAY
 * is squeezed to fit between midnight and the quarter hour, or between the next quarter hour
 * (after now, so the semis has not started when it is delayed) and the next midnight. Dinner keeps
 * its end, so it still runs while the screenshots are taken. At midnight itself the items over by
 * now go to the day before, and in the last quarter hour of a day those ahead go to the next.
 */
export function placeDay(now) {
  const quarter = Math.floor(now / (15 * MIN)) * 15 * MIN;
  const midnight = Math.floor(quarter / (DAY * MIN)) * DAY * MIN;
  const before = (quarter - midnight) / MIN;
  const room = Math.max(0, DAY - before - 16);
  const past = before === 0 ? 1 : Math.min(1, before / BEFORE);
  const ahead = room >= AHEAD ? 1 : room / AHEAD;
  const at = (minutes) => new Date(quarter + minutes * MIN).toISOString();
  const today = TODAY.map(([title, kind, start, end, location, delay]) => {
    let from, to, by;
    if (end <= 0) [from, to, by] = [Math.round(start * past), Math.round(end * past), delay];
    else if (start < 0) [from, to, by] = [Math.max(Math.round(start * past), -before), end, delay];
    else if (ahead === 1) [from, to, by] = [start, end, delay];
    else {
      from = 15 + Math.round(start * ahead);
      to = from + Math.max(5, Math.round((end - start) * ahead));
      by = delay && Math.max(1, Math.round(delay * ahead));
    }
    return { title, kind, starts_at: at(from), ends_at: at(to), location, delay: by };
  });
  const next = (minutes) => new Date(midnight + (DAY + minutes) * MIN).toISOString();
  const tomorrow = TOMORROW.map(([title, kind, start, end, location, delay]) => ({
    title,
    kind,
    starts_at: next(start),
    ends_at: next(end),
    location,
    delay,
  }));
  return [...today, ...tomorrow];
}
