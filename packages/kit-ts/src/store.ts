/** The small Valkey Streams surface the kit needs, and its real implementation. */
import { Valkey } from "iovalkey";

export type StreamEntry = [id: string, fields: Record<string, string>];
export type StreamEntries = [stream: string, entries: StreamEntry[]][];

export interface StreamStore {
  xadd(
    stream: string,
    fields: Record<string, string>,
    options: { maxlen: number; approximate: boolean },
  ): Promise<string>;
  xread(
    streams: Record<string, string>,
    options: { blockMs: number; count: number },
  ): Promise<StreamEntries>;
  /** Names of the streams matching a glob pattern, e.g. `t:*:events:pizza`. */
  scan(pattern: string): Promise<string[]>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

function toFields(flat: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(flat)) {
    for (let i = 0; i + 1 < flat.length; i += 2) out[String(flat[i])] = String(flat[i + 1]);
  }
  return out;
}

/** StreamStore backed by iovalkey. */
export class ValkeyStreamStore implements StreamStore {
  constructor(private readonly client: Valkey) {}

  static fromUrl(url: string): ValkeyStreamStore {
    return new ValkeyStreamStore(new Valkey(url, { maxRetriesPerRequest: null }));
  }

  async xadd(
    stream: string,
    fields: Record<string, string>,
    options: { maxlen: number; approximate: boolean },
  ): Promise<string> {
    const trim = ["MAXLEN", ...(options.approximate ? ["~"] : []), String(options.maxlen)];
    const flat = Object.entries(fields).flat();
    const id = await this.client.call("XADD", stream, ...trim, "*", ...flat);
    return String(id);
  }

  async xread(
    streams: Record<string, string>,
    options: { blockMs: number; count: number },
  ): Promise<StreamEntries> {
    const keys = Object.keys(streams);
    const result = await this.client.call(
      "XREAD",
      "COUNT",
      String(options.count),
      "BLOCK",
      String(options.blockMs),
      "STREAMS",
      ...keys,
      ...keys.map((k) => streams[k] ?? "$"),
    );
    if (!Array.isArray(result)) return [];
    return (result as [unknown, unknown][]).map(([stream, entries]) => [
      String(stream),
      (Array.isArray(entries) ? (entries as [unknown, unknown][]) : []).map(
        ([id, flat]): StreamEntry => [String(id), toFields(flat)],
      ),
    ]);
  }

  async scan(pattern: string): Promise<string[]> {
    const found = new Set<string>();
    let cursor = "0";
    do {
      const [next, keys] = (await this.client.call(
        "SCAN",
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        "1000",
        "TYPE",
        "stream",
      )) as [unknown, unknown[]];
      cursor = String(next);
      for (const key of keys) found.add(String(key));
    } while (cursor !== "0");
    return [...found];
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
