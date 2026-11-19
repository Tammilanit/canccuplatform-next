/** A page form's fields as the sound desk's routes read them (cues/pages.ts, editor-pages.ts). */
export type Form = Record<string, string | string[] | undefined>;
export type Q = {
  Querystring: Record<string, string | undefined>;
  Body: Form;
  Params: { name: string };
};

export const one = (v: Form[string]): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
/** A checkbox list arrives repeated (a list) or, from a plain field, comma-separated. */
export const many = (v: Form[string]): string[] =>
  (Array.isArray(v) ? v : (v ?? "").split(",")).map((s) => s.trim()).filter((s) => s !== "");
export const int = (v: Form[string]): number => (one(v) === "" ? NaN : Number(one(v)));
export const on = (v: Form[string]): boolean => one(v) === "on";
