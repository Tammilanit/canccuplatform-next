/** Types for studio-playlist-editor.js, which the page loads as it is; only the tests read these. */

export declare const PAGE: string;
export declare const ASSET: string;

/** Draws the chosen playlist's editor into `box`; `doc` and `library` are the page's JSON blocks. */
export declare function builder(
  box: unknown,
  doc: unknown,
  write: boolean,
  library: Record<string, unknown>,
): void;
