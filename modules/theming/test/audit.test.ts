/** Audit entries go to `POST /internal/tenants/audit` as theming (contracts/tenants.md, Audit log). */
import { describe, expect, it } from "vitest";
import { KitError, ServiceIdentity } from "@canccu/kit";
import { tenantsAudit } from "../src/audit.js";

const KEY = "k".repeat(32);
const ENTRY = {
  tenant_id: "alpha",
  actor_user_id: "u_admin",
  action: "theming.theme.published",
  target: { type: "theme_revision", id: "1" },
  changes: { revision: { old: 0, new: 1 } },
};

describe("tenantsAudit", () => {
  it("appends the entry as theming, signed for the tenants module", async () => {
    const tenants = new ServiceIdentity({ module: "tenants", key: KEY });
    let seen: { url: string; caller: string; body: unknown } | undefined;
    const audit = tenantsAudit(
      "http://tenants:8080/",
      new ServiceIdentity({ module: "theming", key: KEY }),
      (url, init) => {
        const headers = init?.headers as Record<string, string>;
        seen = {
          url: url as string,
          caller: tenants.verify(headers["x-canccu-service"]),
          body: JSON.parse(init?.body as string) as unknown,
        };
        return Promise.resolve(new Response(null, { status: 201 }));
      },
    );
    await audit(ENTRY);
    expect(seen).toEqual({
      url: "http://tenants:8080/internal/tenants/audit",
      caller: "theming",
      body: { module: "theming", ...ENTRY },
    });
  });

  it("fails the change when the audit log cannot take it", async () => {
    const service = new ServiceIdentity({ module: "theming", key: KEY });
    const refused = tenantsAudit("http://tenants", service, () =>
      Promise.resolve(new Response("{}", { status: 500 })),
    );
    await expect(refused(ENTRY)).rejects.toBeInstanceOf(KitError);
    const down = tenantsAudit("http://tenants", service, () => Promise.reject(new Error("down")));
    await expect(down(ENTRY)).rejects.toMatchObject({ status: 503, code: "tenants_unavailable" });
  });
});
