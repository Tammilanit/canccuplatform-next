// The fake admin of the screen tests (helpers.ts): the sessions it knows and the rights each holds,
// answered as admin's `GET /api/admin/session` answers them.

const ALL_RIGHTS = [
  "screen.devices.read",
  "screen.devices.pair",
  "screen.devices.write",
  "screen.zones.write",
  "screen.content.read",
  "screen.content.write",
  "screen.push.write",
  "screen.ticker.write",
  "screen.photos.write",
  "screen.bundle.write",
];
/** The sessions the fake admin knows; a test may add or remove one (then drop it from `h.rights`). */
export const SESSIONS: Record<string, string[]> = {
  admin: ALL_RIGHTS,
  crew: ["screen.devices.read"],
  // The Moments crew preset with the screen crew's first right (contracts/moments.md, Rights).
  moments: ["screen.devices.read", "moments.read"],
  content: ["screen.content.read"],
  editor: ["screen.content.read", "screen.content.write"],
  ticker: ["screen.ticker.write"],
  photos: ["screen.photos.write"],
  bundler: ["screen.bundle.write"],
  nobody: [],
  // `superadmin` as admin answers it: a platform-bound session with `mfa_enabled` (G2).
  root: [],
};

export async function fakeAdmin(
  _url: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const cookie = (init?.headers as Record<string, string> | undefined)?.cookie ?? "";
  const id = cookie.replace("canccu_session=", "");
  if (id === "admin-down") return Promise.resolve(new Response("down", { status: 503 }));
  const rights = SESSIONS[id];
  if (rights === undefined) {
    return Promise.resolve(
      Response.json({ error: { code: "not_signed_in", message: "no" } }, { status: 401 }),
    );
  }
  return Promise.resolve(
    Response.json({
      user: { id: `u_${id}`, name: id },
      rights,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      superadmin: id === "root",
    }),
  );
}
