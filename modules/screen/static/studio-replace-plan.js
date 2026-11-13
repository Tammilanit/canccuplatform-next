/*
 * The upload's replace plan: per file, keep both or replace a same-named asset. Ported from the
 * legacy `replace-plan.ts` with its tests (test/studio-replace-plan.test.ts); changed: reasons are
 * codes the page words through its message keys, and a match says only whether it is in use.
 * Nothing is replaced unless the person chose it, and only by a file of the asset's kind, since
 * the server refuses a replace across kinds.
 */

const KINDS = [
  [/\.pptx$/, "pptx"],
  [/\.pdf$/, "pdf"],
  [/\.(mp4|m4v|webm|mov|mkv)$/, "video"],
  [/\.(mp3|ogg|oga)$/, "audio"],
  [/\.(png|jpe?g|gif|webp|heic|heif|avif|tiff?)$/, "image"],
];
const TYPES = [
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ["application/pdf", "pdf"],
  ["video/", "video"],
  ["audio/", "audio"],
  ["image/", "image"],
];

/** What the server will most likely call the file; it decides by the content, this by the name. */
export function kindOfFile(name, type) {
  const lower = name.toLowerCase();
  for (const [pattern, kind] of KINDS) if (pattern.test(lower)) return kind;
  for (const [prefix, kind] of TYPES)
    if ((type || "").toLowerCase().startsWith(prefix)) return kind;
  return null;
}

export function replacePlan({ files, matches, choice, own = {} }) {
  const seen = new Set();
  return files.map((file, index) => {
    const found = matches[index] ?? [];
    const lower = file.name.trim().toLowerCase();
    const again = seen.has(lower);
    seen.add(lower);
    const kind = kindOfFile(file.name, file.type);
    const eligible = found.filter((m) => m.kind === kind);
    let reason = null;
    if (found.length > 0 && again) reason = "batch";
    else if (found.length > 0 && eligible.length === 0) reason = "kind";
    const canReplace = found.length > 0 && reason === null;
    const mine = own[index];
    const wanted = mine?.choice ?? choice;
    // One candidate is the obvious target; among several, the person picks (nothing preselected).
    const target =
      eligible.find((m) => m.id === mine?.assetId) ?? (eligible.length === 1 ? eligible[0] : null);
    const wantsReplace = canReplace && wanted === "replace";
    const replace = wantsReplace && target !== null;
    return {
      name: file.name,
      matches: found,
      eligible,
      conflict: found.length > 0,
      canReplace,
      reason,
      otherKind: reason === "kind" ? found[0].kind : null,
      choice: replace ? "replace" : "keep",
      replaceId: replace ? target.id : null,
      needsPick: wantsReplace && target === null,
      onlyOneUsed: found.length > 1 && found.filter((m) => m.used).length === 1,
    };
  });
}
