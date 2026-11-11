/**
 * Server-Sent Events read from a fetch body. The player does not use EventSource: it hides the
 * answer's status (a 401, 403 or 409 decides which frame the kiosk shows) and reconnects on its
 * own fixed delay, where the contract wants backoff with jitter (contracts/screen.md, Resume).
 * Parsing follows the HTML standard's event-stream rules.
 */

export interface SseMessage {
  event: string;
  data: string;
  /** The last `id:` seen so far, as the standard keeps it across messages. */
  id: string;
}

export class SseParser {
  private buffer = "";
  private event = "";
  private data: string[] = [];
  private lastId = "";
  /** The server's `retry:` in milliseconds, once it has sent one. */
  retry: number | null = null;

  /** Feed a decoded chunk; answers the messages it completes. */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      // A lone \r at the end may be the first half of \r\n: wait for the next chunk.
      if (match === null || (match[0] === "\r" && match.index === this.buffer.length - 1)) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const message = this.line(line);
      if (message !== null) out.push(message);
    }
    return out;
  }

  private line(line: string): SseMessage | null {
    if (line === "") {
      const message =
        this.data.length === 0
          ? null
          : { event: this.event || "message", data: this.data.join("\n"), id: this.lastId };
      this.event = "";
      this.data = [];
      return message;
    }
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    else if (field === "id" && !value.includes("\0")) this.lastId = value;
    else if (field === "retry" && /^\d+$/.test(value)) this.retry = Number(value);
    return null;
  }
}
