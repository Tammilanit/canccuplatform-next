/**
 * The zone's fields as a preview stores and composes them (src/zone-input.ts, zoneFields; #488):
 * one helper for the device preview and the zone preview, so a new zone field cannot be missed
 * in one of them. Every field the input reads is kept; only the revision read is not.
 */
import { describe, expect, it } from "vitest";
import { zoneFields, zoneInput } from "../src/zone-input.js";

describe("a zone's preview fields", () => {
  it("are every field of the zone read, without its revision", () => {
    const input = zoneInput({
      key: "hall",
      name: "Hall",
      layout_id: "dashboard",
      regions: { hero: { hidden: true } },
      header: "shared",
      hub_qr: "rotate",
      screen_name: "always",
      hero_region: "online",
      grow_for_showcase: false,
      motion_level: "calm",
      sound: { enabled: false, device_id: "dv_1" },
      revision: 4,
    });
    const { revision, ...rest } = input;
    expect(revision).toBe(4);
    expect(zoneFields(input)).toEqual(rest);
  });
});
