/** The Studio's own stylesheets and scripts, served from static/, and packages/ui's ui.css. */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const STATIC = new URL("../../static/", import.meta.url);

export const STATIC_TYPES: Record<string, string> = {
  "ui.css": "text/css; charset=utf-8",
  "studio.css": "text/css; charset=utf-8",
  "studio.js": "text/javascript; charset=utf-8",
  "studio-zone.css": "text/css; charset=utf-8",
  "studio-zone.js": "text/javascript; charset=utf-8",
  "studio-screen-preview.js": "text/javascript; charset=utf-8",
  "studio-layout.css": "text/css; charset=utf-8",
  "studio-schedule.css": "text/css; charset=utf-8",
  "studio-schedule.js": "text/javascript; charset=utf-8",
  "studio-schedule-edit.js": "text/javascript; charset=utf-8",
  "studio-schedule-edit.css": "text/css; charset=utf-8",
  "studio-content.css": "text/css; charset=utf-8",
  "studio-content.js": "text/javascript; charset=utf-8",
  "studio-replace-plan.js": "text/javascript; charset=utf-8",
  "studio-playlists.css": "text/css; charset=utf-8",
  "studio-playlists.js": "text/javascript; charset=utf-8",
  "studio-playlist-builder.js": "text/javascript; charset=utf-8",
  "studio-playlist-editor.js": "text/javascript; charset=utf-8",
  "studio-playlist-item.js": "text/javascript; charset=utf-8",
  "studio-boxes.js": "text/javascript; charset=utf-8",
  "studio-layout.js": "text/javascript; charset=utf-8",
  "studio-motion.css": "text/css; charset=utf-8",
  "studio-motion.js": "text/javascript; charset=utf-8",
};

const staticFiles = new Map<string, Promise<Buffer>>();
export function staticFile(name: string): Promise<Buffer> {
  let bytes = staticFiles.get(name);
  if (bytes === undefined) {
    // ui.css is packages/ui's own, so the Studio looks like every other organiser page.
    const path =
      name === "ui.css"
        ? createRequire(import.meta.url).resolve("@canccu/ui/ui.css")
        : new URL(name, STATIC);
    // A failed read is forgotten, so the next request tries again instead of failing forever.
    bytes = readFile(path).catch((err: unknown) => {
      staticFiles.delete(name);
      throw err;
    });
    staticFiles.set(name, bytes);
  }
  return bytes;
}
