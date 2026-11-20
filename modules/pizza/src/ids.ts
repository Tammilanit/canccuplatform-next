import { randomBytes } from "node:crypto";

/** An id nobody can guess or count through (the legacy's numeric ids were, problem 9). */
export const newId = (prefix: string): string =>
  `${prefix}_${randomBytes(12).toString("base64url")}`;
