/** Test helpers for modules that use the kit: an in-memory StreamStore. */
import type { StreamEntries, StreamEntry, StreamStore } from "./store.js";

export interface XAddCall {
  stream: string;
  fields: Record<string, string>;
  maxlen: number;
  approximate: boolean;
}

/** Keeps streams in memory and records every xadd call (trimming is recorded, not applied). */
export class MemoryStreamStore implements StreamStore {
  readonly streams = new Map<string, StreamEntry[]>();
  readonly calls: XAddCall[] = [];
  healthy = true;
  private seq = 0;
  private waiters: (() => void)[] = [];

  appendRaw(stream: string, fields: Record<string, string>): string {
    this.seq += 1;
    const id = `${this.seq}-0`;
    const list = this.streams.get(stream) ?? [];
    list.push([id, { ...fields }]);
    this.streams.set(stream, list);
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
    return id;
  }

  xadd(
    stream: string,
    fields: Record<string, string>,
    options: { maxlen: number; approximate: boolean },
  ): Promise<string> {
    this.calls.push({ stream, fields: { ...fields }, ...options });
    return Promise.resolve(this.appendRaw(stream, fields));
  }

  private lastId(stream: string): string {
    const list = this.streams.get(stream);
    return list?.[list.length - 1]?.[0] ?? "0-0";
  }

  async xread(
    streams: Record<string, string>,
    options: { blockMs: number; count: number },
  ): Promise<StreamEntries> {
    const start = Object.entries(streams).map(([s, id]): [string, number] => [
      s,
      Number((id === "$" ? this.lastId(s) : id).split("-")[0]),
    ]);
    const collect = (): StreamEntries =>
      start.flatMap(([stream, after]): StreamEntries => {
        const found = (this.streams.get(stream) ?? []).filter(
          ([id]) => Number(id.split("-")[0]) > after,
        );
        return found.length > 0 ? [[stream, found.slice(0, options.count)]] : [];
      });
    const found = collect();
    if (found.length > 0 || options.blockMs <= 0) return found;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, options.blockMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    return collect();
  }

  ping(): Promise<void> {
    return this.healthy ? Promise.resolve() : Promise.reject(new Error("valkey unreachable"));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
