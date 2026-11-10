/**
 * The package manifest's schema, contracts/theme.schema.json, read from the contract itself so the
 * module and the contract never disagree. The Dockerfile copies it into the image at the same place.
 */
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";

const SCHEMA_URL = new URL("../../../contracts/theme.schema.json", import.meta.url);

interface Group {
  properties?: Record<string, { $ref?: string }>;
  enum?: unknown[];
}

const schema = JSON.parse(readFileSync(SCHEMA_URL, "utf8")) as {
  $id: string;
  $defs: { tokens: { properties: Record<string, Group> } };
};

// strictTypes off: the schema's if/then branches name `type` only where the contract needs it.
const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
ajv.addSchema(schema);

const def = (name: string): string => `${schema.$id}#/$defs/${name}`;

/** A token edit names each token, its value or `null` (contracts/theming.openapi.yaml, TokensEdit). */
function tokensEditSchema(): object {
  const groups = schema.$defs.tokens.properties;
  const nullable = (group: Group): object => ({
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      Object.entries(group.properties ?? {}).map(([name, value]) => [
        name,
        // The schema's refs are relative to it; here they must name it.
        { oneOf: [value.$ref ? { $ref: schema.$id + value.$ref } : value, { type: "null" }] },
      ]),
    ),
  });
  return {
    type: "object",
    additionalProperties: false,
    required: ["draft_version", "tokens"],
    properties: {
      draft_version: { type: "integer", minimum: 1 },
      tokens: {
        type: "object",
        additionalProperties: false,
        properties: {
          colors: nullable(groups.colors ?? {}),
          fonts: nullable(groups.fonts ?? {}),
          sizes: nullable(groups.sizes ?? {}),
          motion: { enum: [...(groups.motion?.enum ?? []), null] },
        },
      },
    },
  };
}

const manifestCheck = ajv.getSchema(schema.$id) as ValidateFunction;
const layoutCheck = ajv.compile({ $ref: def("layout") });
const tokensEditCheck = ajv.compile(tokensEditSchema());

export type TokenValue = string | null;
export interface TokensEdit {
  draft_version: number;
  tokens: {
    colors?: Record<string, TokenValue>;
    fonts?: Record<string, TokenValue>;
    sizes?: Record<string, TokenValue>;
    motion?: TokenValue;
  };
}

function describe(errors: ErrorObject[] | null | undefined): string {
  const first = errors?.[0];
  return first === undefined
    ? "invalid"
    : `${first.instancePath || "the body"} ${first.message ?? "is invalid"}`;
}

/** The manifest's schema errors, as `schema` problems at their JSON pointer. */
export function schemaErrors(manifest: unknown): { path: string; message: string }[] {
  if (manifestCheck(manifest)) return [];
  return (manifestCheck.errors ?? []).map((e) => ({
    path: `theme.yaml#${e.instancePath}`,
    message: `${e.instancePath || "theme.yaml"} ${e.message ?? "is invalid"}`,
  }));
}

/** undefined when `body` is a layout of theme.schema.json, else why not. */
export function layoutError(body: unknown): string | undefined {
  return layoutCheck(body) ? undefined : describe(layoutCheck.errors);
}

export function tokensEditError(body: unknown): string | undefined {
  return tokensEditCheck(body) ? undefined : describe(tokensEditCheck.errors);
}
