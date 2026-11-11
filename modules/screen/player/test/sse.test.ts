import { describe, expect, it } from "vitest";
import { SseParser } from "../src/sse.js";

describe("the event-stream parser", () => {
  it("reads named messages with their ids and the retry", () => {
    const p = new SseParser();
    const out = p.push('retry: 2000\n\nid: main.e1.4\nevent: widget\ndata: {"a":1}\n\n');
    expect(out).toEqual([{ event: "widget", data: '{"a":1}', id: "main.e1.4" }]);
    expect(p.retry).toBe(2000);
  });

  it("joins data lines, skips comments and keeps the id for later messages", () => {
    const p = new SseParser();
    const out = p.push(": hello\nid: z.1.1\ndata: a\ndata: b\n\ndata: c\n\n");
    expect(out).toEqual([
      { event: "message", data: "a\nb", id: "z.1.1" },
      { event: "message", data: "c", id: "z.1.1" },
    ]);
  });

  it("completes a message split across chunks, also between \\r and \\n", () => {
    const p = new SseParser();
    expect(p.push("event: ping\r")).toEqual([]);
    expect(p.push("\ndata: {}\r\n")).toEqual([]);
    expect(p.push("\r\n")).toEqual([{ event: "ping", data: "{}", id: "" }]);
  });

  it("dispatches nothing for a block without data", () => {
    const p = new SseParser();
    expect(p.push("event: state\n\n")).toEqual([]);
    expect(p.push("data: x\n\n")).toEqual([{ event: "message", data: "x", id: "" }]);
  });
});
