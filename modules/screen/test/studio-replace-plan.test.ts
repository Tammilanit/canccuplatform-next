/**
 * The upload's replace plan (static/studio-replace-plan.js), ported with its tests from the legacy
 * `replace-plan.ts`: nothing is replaced unless chosen, and only by a file of the asset's kind.
 */
import { describe, expect, it } from "vitest";
import { kindOfFile, replacePlan } from "../static/studio-replace-plan.js";
import type { Match } from "../static/studio-replace-plan.js";

const match = (id: string, kind: string, used = false): Match => ({ id, kind, used });

describe("replace plan", () => {
  const files = [
    { name: "a.png", type: "image/png" },
    { name: "b.png", type: "image/png" },
    { name: "deck.pptx", type: "" },
  ];

  it("tells a file's kind from its name or type, as the server will from its content", () => {
    expect(kindOfFile("Talk.PPTX", "")).toBe("pptx");
    expect(kindOfFile("talk.pdf", "")).toBe("pdf");
    expect(kindOfFile("clip.webm", "")).toBe("video");
    expect(kindOfFile("clip", "video/mp4")).toBe("video");
    expect(kindOfFile("chime.ogg", "")).toBe("audio");
    expect(kindOfFile("poster.jpg", "image/jpeg")).toBe("image");
    expect(kindOfFile("notes.txt", "text/plain")).toBeNull();
  });

  it("replaces nothing without a conflict, even when replace is the choice", () => {
    const plan = replacePlan({ files, matches: [[], [], []], choice: "replace" });
    expect(plan.every((e) => e.choice === "keep" && e.replaceId === null)).toBe(true);
    expect(plan.every((e) => !e.conflict)).toBe(true);
  });

  it("keeps both by default; replace for all applies; a file's own choice wins", () => {
    const matches = [[match("A", "image")], [match("B", "image")], []];
    expect(replacePlan({ files, matches, choice: "keep" }).map((e) => e.choice)).toEqual([
      "keep",
      "keep",
      "keep",
    ]);
    expect(replacePlan({ files, matches, choice: "replace" }).map((e) => e.replaceId)).toEqual([
      "A",
      "B",
      null,
    ]);
    const plan = replacePlan({ files, matches, choice: "replace", own: { 0: { choice: "keep" } } });
    expect(plan.map((e) => e.replaceId)).toEqual([null, "B", null]);
  });

  it("preselects nothing among several matches: the person picks one", () => {
    const matches = [[match("A1", "image"), match("A2", "image")], [], []];
    const unpicked = replacePlan({ files, matches, choice: "replace" })[0];
    expect(unpicked).toMatchObject({ choice: "keep", replaceId: null, needsPick: true });
    expect(replacePlan({ files, matches, choice: "keep" })[0]?.needsPick).toBe(false);
    const plan = replacePlan({
      files,
      matches,
      choice: "keep",
      own: { 0: { choice: "replace", assetId: "A2" } },
    });
    expect(plan[0]?.replaceId).toBe("A2");
  });

  it("refuses to replace an asset of another kind, and says which kind it is", () => {
    const matches = [[], [], [match("I", "image")]];
    const plan = replacePlan({
      files,
      matches,
      choice: "replace",
      own: { 2: { choice: "replace", assetId: "I" } },
    });
    expect(plan[2]).toMatchObject({
      conflict: true,
      canReplace: false,
      choice: "keep",
      replaceId: null,
      reason: "kind",
      otherKind: "image",
    });
  });

  it("keeps both for the second file of one name in a batch", () => {
    const twice = [
      { name: "a.png", type: "image/png" },
      { name: "A.PNG", type: "image/png" },
    ];
    const matches = [[match("A", "image")], [match("A", "image")]];
    const plan = replacePlan({ files: twice, matches, choice: "replace" });
    expect(plan.map((e) => e.choice)).toEqual(["replace", "keep"]);
    expect(plan[1]?.reason).toBe("batch");
  });

  it("warns when exactly one of several matches is in use", () => {
    const used = match("A1", "image", true);
    const plan = (m: Match[]) => replacePlan({ files, matches: [m, [], []], choice: "keep" })[0];
    expect(plan([used, match("A2", "image")])?.onlyOneUsed).toBe(true);
    expect(plan([used, match("A2", "image", true)])?.onlyOneUsed).toBe(false);
    expect(plan([used])?.onlyOneUsed).toBe(false);
  });
});
