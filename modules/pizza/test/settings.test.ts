/** The event's food settings as pizza reads them: each falls back to its default when not valid. */
import { describe, expect, it } from "vitest";
import type { SettingsClient } from "@canccu/kit";
import { DEFAULT_SETTINGS, settingsReader } from "../src/settings.js";

const client = (values: Record<string, unknown>) =>
  ({
    ensure: () => Promise.resolve(),
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  }) as unknown as SettingsClient;

describe("the AI reader's monthly limit (ai_reader_monthly_limit_usd)", () => {
  it("is 0, none, by default", async () => {
    expect(DEFAULT_SETTINGS.ai_reader_monthly_limit_usd).toBe(0);
    expect((await settingsReader(client({}))("demo")).ai_reader_monthly_limit_usd).toBe(0);
  });

  it("takes whole dollars from 0 to 1000, as the provider's Console sets it, and nothing else", async () => {
    const limit = async (v: unknown) =>
      (await settingsReader(client({ ai_reader_monthly_limit_usd: v }))("demo"))
        .ai_reader_monthly_limit_usd;
    expect(await limit(5)).toBe(5);
    expect(await limit(12.5)).toBe(0);
    expect(await limit(1000)).toBe(1000);
    expect(await limit(1001)).toBe(0);
    expect(await limit(-1)).toBe(0);
    expect(await limit("5")).toBe(0);
  });
});
