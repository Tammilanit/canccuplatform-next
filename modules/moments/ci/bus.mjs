// A domain event straight onto a module's tenant stream in Valkey, as that module sends it (the
// kit's bus: one `event` field), for the Moments checks scripts/demo-stack-test runs in the screen
// container, where Valkey is `valkey:6379`. In RESP, so the checks need no client library.
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { connect } from "node:net";

export function xadd(tenant, module, type, data) {
  const e = {
    id: randomUUID(),
    type,
    version: 1,
    time: new Date().toISOString(),
    source: module,
    tenant,
    data,
  };
  const args = ["XADD", `t:${tenant}:events:${module}`, "*", "event", JSON.stringify(e)];
  const cmd = `*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join("")}`;
  return new Promise((resolve, reject) => {
    const s = connect(6379, "valkey", () => s.write(cmd));
    s.once("data", (d) => {
      s.end();
      if (d.toString().startsWith("-")) reject(new Error(`XADD: ${d}`));
      else resolve();
    });
    s.on("error", reject);
  });
}
