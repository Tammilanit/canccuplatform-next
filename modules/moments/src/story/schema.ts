/**
 * A story's shape, by the contract's own storyboard.schema.json (#114: stories are data validated
 * by a JSON schema), read from the contract so the module and the contract never disagree. The
 * Dockerfile copies it into the image at the same place. The rules the schema cannot say are
 * check.ts's, run after it.
 */
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv/dist/2020.js";

const SCHEMA_URL = new URL("../../../../contracts/moments/storyboard.schema.json", import.meta.url);
const schema = JSON.parse(readFileSync(SCHEMA_URL, "utf8")) as { $id: string };

const ajv = new Ajv2020({ allErrors: false, strict: false });
const storyCheck = ajv.compile(schema);

/** The fields GET adds to each story (storyboards.openapi.yaml); a client may send them back. */
const READ_ONLY = ["free_variables", "rule_off"];

function words(e: ErrorObject): string {
  const where = e.instancePath === "" ? "the story" : e.instancePath.slice(1).replaceAll("/", ".");
  const p = e.params as { additionalProperty?: string; missingProperty?: string };
  if (p.additionalProperty !== undefined) return `${where} has an unknown ${p.additionalProperty}.`;
  if (p.missingProperty !== undefined) return `${where} has no ${p.missingProperty}.`;
  return `${where} ${e.message ?? "is invalid"}.`;
}

/** Each story without GET's read-only fields, or why one breaks the schema, naming it. */
export function schemaChecked(list: unknown[]): unknown[] | string {
  const out: unknown[] = [];
  for (const [i, raw] of list.entries()) {
    const s =
      typeof raw === "object" && raw !== null && !Array.isArray(raw)
        ? Object.fromEntries(Object.entries(raw).filter(([k]) => !READ_ONLY.includes(k)))
        : raw;
    if (!storyCheck(s)) {
      const name = (s as { name?: unknown } | null)?.name;
      const who = typeof name === "string" ? name : `Story ${String(i + 1)}`;
      return `${who}: ${words(storyCheck.errors?.[0] as ErrorObject)}`;
    }
    out.push(s);
  }
  return out;
}
