/**
 * The package manifest's schema, contracts/theme.schema.json, read from the contract itself so the
 * module and the contract never disagree. The Dockerfile copies it into the image at the same place.
 */
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import type { Backdrop, Brand } from "./brand.js";
import type { LogoPlate } from "./logo-plate.js";

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
          // contracts/theming.openapi.yaml, TokensEdit: the object or null; a null field is its default.
          motion_style: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                properties: Object.fromEntries(
                  Object.entries(groups.motion_style?.properties ?? {}).map(([name, value]) => [
                    name,
                    { enum: [...((value as Group).enum ?? []), null] },
                  ]),
                ),
              },
              { type: "null" },
            ],
          },
        },
      },
    },
  };
}

/** contracts/theming.openapi.yaml, BrandInput. */
const brandInputCheck = ajv.compile({
  type: "object",
  additionalProperties: false,
  required: ["draft_version", "primary", "accent", "scheme"],
  properties: {
    draft_version: { type: "integer", minimum: 1 },
    logo: { $ref: def("image_path") },
    icon: { $ref: def("image_path") },
    primary: { $ref: def("color") },
    accent: { $ref: def("color") },
    scheme: { enum: ["dark", "light"] },
    embed_color: { $ref: def("color") },
    logo_plate: { $ref: def("logo_plate") },
    // null takes the pair away: the platform font (the Studio's "Platform font").
    font_pair: {
      oneOf: [{ type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,39}$" }, { type: "null" }],
    },
    roundness: { enum: ["square", "soft", "round", "pill"] },
    backdrop: { $ref: def("backdrop") },
    box_opacity: { $ref: def("box_opacity") },
  },
});

/** The body of `POST …/draft/mode`: only the confirmed switch back to simple exists. */
const modeSwitchCheck = ajv.compile({
  type: "object",
  additionalProperties: false,
  required: ["draft_version", "mode", "remove_advanced"],
  properties: {
    draft_version: { type: "integer", minimum: 1 },
    mode: { const: "simple" },
    remove_advanced: { const: true },
  },
});

/**
 * The body of `PATCH …/draft/parts` (Advanced, plan issue-784 D15, D16): theme.yaml's lists as the
 * manifest's schema has them, templates and box looks by name with `null` taking one away.
 */
const partsEditCheck = ajv.compile({
  type: "object",
  additionalProperties: false,
  required: ["draft_version"],
  minProperties: 2,
  properties: {
    draft_version: { type: "integer", minimum: 1 },
    css: { $ref: `${schema.$id}#/properties/css` },
    fonts: { $ref: `${schema.$id}#/properties/fonts` },
    templates: {
      type: "object",
      maxProperties: 64,
      propertyNames: { $ref: def("name") },
      additionalProperties: { oneOf: [{ $ref: def("template") }, { type: "null" }] },
    },
    looks: {
      type: "object",
      maxProperties: 64,
      propertyNames: { $ref: def("widget_type") },
      additionalProperties: { oneOf: [{ $ref: def("name") }, { type: "null" }] },
    },
    backdrop_image: { oneOf: [{ $ref: def("image_path") }, { type: "null" }] },
    backdrop_video: { oneOf: [{ $ref: def("video_path") }, { type: "null" }] },
  },
});

export interface PartsEdit {
  draft_version: number;
  css?: string[];
  fonts?: Record<string, unknown>[];
  templates?: Record<string, { widget: string; file: string } | null>;
  looks?: Record<string, string | null>;
  backdrop_image?: string | null;
  backdrop_video?: string | null;
}

export function partsEditError(body: unknown): string | undefined {
  return partsEditCheck(body) ? undefined : describe(partsEditCheck.errors);
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
    motion_style?: Record<string, TokenValue> | null;
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

export interface BrandEdit {
  draft_version: number;
  logo?: string;
  icon?: string;
  primary: string;
  accent: string;
  scheme: "dark" | "light";
  embed_color?: string;
  logo_plate?: LogoPlate;
  font_pair?: string | null;
  roundness?: Brand["roundness"];
  backdrop?: Backdrop;
  box_opacity?: number;
}

export function brandInputError(body: unknown): string | undefined {
  return brandInputCheck(body) ? undefined : describe(brandInputCheck.errors);
}

export function modeSwitchError(body: unknown): string | undefined {
  return modeSwitchCheck(body) ? undefined : describe(modeSwitchCheck.errors);
}

export function tokensEditError(body: unknown): string | undefined {
  return tokensEditCheck(body) ? undefined : describe(tokensEditCheck.errors);
}
