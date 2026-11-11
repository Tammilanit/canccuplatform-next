/** Text a person writes in a package: CSS, templates, licences, an embed's code. */

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** UTF-8 with no control characters but tabs, line and page breaks; undefined otherwise. */
export function readText(bytes: Buffer): string | undefined {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text) ? undefined : text;
}

/** Whether `path`'s parts are all real names: no empty, `.` or `..` part. */
export const plainPath = (path: string): boolean =>
  path.split("/").every((part) => part !== "" && part !== "." && part !== "..");

/** A package image, by its package path (as in theme.yaml): what url() and an img's src may name. */
export const IMAGE = /^images\/[A-Za-z0-9._/-]+\.(png|jpe?g|webp|svg)$/i;
