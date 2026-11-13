import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { isConnectionError, retrying, stopReason } from "./stack/retry.mjs";

const noWait = () => Promise.resolve();

describe("isConnectionError", () => {
  it("knows a dropped, refused or timed-out connection", () => {
    for (const err of [
      Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8080"), { code: "ECONNREFUSED" }),
      new Error("socket hang up"),
      new Error("PUT /api/screen/ticker timed out"),
      new Error("apiRequestContext.fetch: read ECONNRESET"),
      new Error("apiRequestContext.fetch: Timeout 30000ms exceeded."),
    ]) {
      expect(isConnectionError(err), err.message).toBe(true);
    }
  });

  it("does not take an answer or a page error for one", () => {
    expect(isConnectionError(new Error('ticker: HTTP 500 {"error":{}}'))).toBe(false);
    expect(isConnectionError(new Error("Target page, context or browser has been closed"))).toBe(
      false,
    );
    expect(isConnectionError("ECONNRESET")).toBe(false);
  });
});

describe("retrying", () => {
  it("tries a dropped connection again and answers the first success", async () => {
    let tries = 0;
    const answer = await retrying(
      () => {
        tries++;
        if (tries < 3) return Promise.reject(new Error("socket hang up"));
        return Promise.resolve("ok");
      },
      { wait: noWait },
    );
    expect(answer).toBe("ok");
    expect(tries).toBe(3);
  });

  it("gives up after its tries and says how many it made", async () => {
    let tries = 0;
    const failed = retrying(
      () => {
        tries++;
        return Promise.reject(new Error("read ECONNRESET"));
      },
      { tries: 3, wait: noWait },
    );
    await expect(failed).rejects.toMatchObject({ message: "read ECONNRESET", tries: 3 });
    expect(tries).toBe(3);
  });

  it("does not retry what is not a connection failure", async () => {
    let tries = 0;
    const failed = retrying(
      () => {
        tries++;
        return Promise.reject(new Error("ticker: HTTP 500 null"));
      },
      { wait: noWait },
    );
    await expect(failed).rejects.toThrow("HTTP 500");
    expect(tries).toBe(1);
  });

  it("gets through a server that drops the first connection", async () => {
    let seen = 0;
    const server = createServer((req, res) => {
      if (++seen === 1) {
        req.socket.destroy();
        return;
      }
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const body = await retrying(
        () =>
          new Promise<string>((resolve, reject) => {
            get(`http://127.0.0.1:${port}/`, (res) => {
              res.setEncoding("utf8");
              let text = "";
              res.on("data", (c: string) => {
                text += c;
              });
              res.on("end", () => {
                resolve(text);
              });
            }).on("error", reject);
          }),
        { wait: noWait },
      );
      expect(body).toBe("ok");
      expect(seen).toBe(2);
    } finally {
      server.close();
    }
  });
});

describe("stopReason", () => {
  it("names a connection failure apart from a heap overrun", () => {
    const err = Object.assign(new Error("read ECONNRESET"), { tries: 3 });
    expect(stopReason(err)).toBe(
      "a connection to screen failed after 3 tries (not a heap overrun): read ECONNRESET",
    );
  });

  it("names anything else as the run stopping", () => {
    expect(stopReason(new Error("page.clock.fastForward: Target crashed"))).toBe(
      "the run stopped: page.clock.fastForward: Target crashed",
    );
  });
});
