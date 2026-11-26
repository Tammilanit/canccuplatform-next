// The screens shots with the event's storyboards off (stack/stories.mjs, #813): a preset's round
// on the main hall's hero (Meal is served, which the fixture's Dinner starts when a run begins
// in the hour after midnight) failed the Pulse's checks of the screens it does not belong to.
import { describe, expect, it } from "vitest";
import { screenShots } from "./stack/screens.mjs";
import { storiesOff } from "./stack/stories.mjs";

const PATH = "/api/moments/storyboards";

interface Story {
  key: string;
  enabled: boolean;
}

/** Moments' storyboards as the API keeps them, and every call made; any other path is down. */
function moments(stories: Story[], refuse: number | null = null) {
  const doc = { stories: structuredClone(stories), revision: 4 };
  const calls: string[] = [];
  const demo = {
    call: (method: string, path: string, o: { body?: { stories: Story[]; revision: number } }) => {
      const on = () => doc.stories.filter((s) => s.enabled).map((s) => s.key);
      if (path !== PATH) {
        calls.push(`${method} ${path}`);
        return Promise.reject(new Error(`${path}: the stack is down`));
      }
      if (method === "GET") {
        calls.push(`GET on: ${on().join(",")}`);
        return Promise.resolve({ status: 200, body: structuredClone(doc) });
      }
      if (refuse !== null) return Promise.resolve({ status: refuse, body: { code: "refused" } });
      if (o.body?.revision !== doc.revision)
        return Promise.resolve({ status: 409, body: { code: "version_conflict" } });
      doc.stories = o.body.stories;
      doc.revision += 1;
      calls.push(`PUT on: ${on().join(",")}`);
      return Promise.resolve({ status: 200, body: structuredClone(doc) });
    },
  };
  return { demo, doc, calls };
}

const STORIES = [
  { key: "doors_open", enabled: true },
  { key: "meal_served", enabled: true },
  { key: "sponsor_thanks", enabled: false },
];

describe("the storyboards while the screens are shot", () => {
  it("are all turned off, then back on as they were, against the revision read each time", async () => {
    const { demo, doc, calls } = moments(STORIES);
    const back = await storiesOff(demo);
    expect(doc.stories.filter((s) => s.enabled)).toEqual([]);
    await back();
    expect(doc.stories).toEqual(STORIES);
    expect(doc.revision).toBe(6);
    expect(calls).toEqual([
      "GET on: doors_open,meal_served",
      "PUT on: ",
      "GET on: ",
      "PUT on: doors_open,meal_served",
    ]);
  });

  it("are left alone when none is on", async () => {
    const off = STORIES.map((s) => ({ ...s, enabled: false }));
    const { demo, calls } = moments(off);
    const back = await storiesOff(demo);
    await back();
    expect(calls).toEqual(["GET on: "]);
  });

  it("fail the screens with what was asked when Moments refuses", async () => {
    const { demo } = moments(STORIES, 403);
    await expect(storiesOff(demo)).rejects.toThrow(/turning the storyboards off: HTTP 403/);
  });

  it("are off before the screens seed their run of show, and on again when the screens end", async () => {
    const { demo, doc, calls } = moments(STORIES);
    const run = { demo, browser: undefined, at: String, out: "", fail: String, ok: String };
    await expect(screenShots({ ...run, cookieOn: String })).rejects.toThrow(/the stack is down/);
    expect(calls).toEqual([
      "GET on: doors_open,meal_served",
      "PUT on: ",
      "GET /api/agenda/items",
      "GET on: ",
      "PUT on: doors_open,meal_served",
    ]);
    expect(doc.stories).toEqual(STORIES);
  });
});
