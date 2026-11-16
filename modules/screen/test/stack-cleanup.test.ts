// The stack tests' cleanup (stack/cleanup.mjs, #583): every step runs even when one fails, a device
// left paired would play on, and an error the run already threw is the one that reaches the check.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanUp } from "./stack/cleanup.mjs";
import { SCREEN, event } from "./stack/client.mjs";

describe("the stack tests' cleanup", () => {
  let server: Server;
  const revoked: string[] = [];
  beforeAll(async () => {
    // Screen as the stack has it, except that device b cannot be revoked.
    server = createServer((req, res) => {
      const id = /^\/api\/screen\/devices\/(\w+)\/revoke$/.exec(req.url ?? "")?.[1];
      if (id === undefined) return res.writeHead(404).end();
      revoked.push(id);
      if (id === "b") return res.writeHead(500, { "content-type": "application/json" }).end("{}");
      res.writeHead(204).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    SCREEN.port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("revokes every device when one revoke fails mid-loop, then throws once", async () => {
    revoked.length = 0;
    const demo = event("demo.localhost");
    const after = vi.fn();
    const steps = [...["a", "b", "c"].map((id) => () => demo.revoke(id)), after];
    await expect(cleanUp(steps)).rejects.toThrow(/revoking device b: HTTP 500/);
    expect(revoked).toEqual(["a", "b", "c"]);
    expect(after).toHaveBeenCalledOnce();
  });

  it("throws one error naming every step that failed", async () => {
    const fails = (m: string) => () => Promise.reject(new Error(m));
    const error = await cleanUp([fails("first"), fails("second")]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
    expect((error as Error).message).toBe("cleanup failed: first; second");
  });

  it("does not replace an error the run already threw, and still runs every step", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const after = vi.fn();
    const run = async () => {
      let threw = false;
      try {
        throw new Error("the layout did not draw");
      } catch (err) {
        threw = true;
        throw err;
      } finally {
        await cleanUp([() => Promise.reject(new Error("revoking device b")), after], threw);
      }
    };
    await expect(run()).rejects.toThrow("the layout did not draw");
    expect(after).toHaveBeenCalledOnce();
    // Not lost either: one failure never hides another.
    expect(logged).toHaveBeenCalledWith("cleanup failed: revoking device b");
    logged.mockRestore();
  });

  it("passes quietly when every step does", async () => {
    await expect(cleanUp([() => Promise.resolve(), () => undefined])).resolves.toBeUndefined();
  });
});
