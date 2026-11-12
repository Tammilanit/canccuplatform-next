/** When a zone's content widgets next change by themselves (contentFacts' `changesAt`). */
import type { TenantContext } from "@canccu/kit";
import { describe, expect, it } from "vitest";
import { contentFacts, ROTATE_RETRY_MS } from "../src/compose/content.js";
import type { ContentDeps } from "../src/compose/content.js";

const NOW = Date.parse("2026-01-01T12:00:30Z");
const ctx = { tenant_id: "alpha", flags: {} } as unknown as TenantContext;

const deps = (rotatesAt: string) =>
  ({
    sources: {
      checkinCode: () =>
        Promise.resolve({
          purpose: "arrival",
          code: "x",
          url: "/notify/check-in?p=arrival&c=x",
          valid_until: "2026-01-01T12:01:30Z",
          rotates_at: rotatesAt,
        }),
    },
  }) as unknown as ContentDeps;

describe("the check-in code's next change", () => {
  it("is its rotation while that is ahead", async () => {
    const { changesAt } = await contentFacts(
      deps("2026-01-01T12:01:00Z"),
      ctx,
      "main",
      new Set(["checkin_qr"]),
      NOW,
    );
    expect(changesAt).toBe(Date.parse("2026-01-01T12:01:00Z"));
  });

  it("is a short retry when this clock has already passed the rotation", async () => {
    for (const at of ["2026-01-01T12:00:30Z", "2026-01-01T12:00:29.500Z"]) {
      const { changesAt } = await contentFacts(deps(at), ctx, "main", new Set(["checkin_qr"]), NOW);
      expect(changesAt).toBe(NOW + ROTATE_RETRY_MS);
    }
  });
});
