/** Does a menu item match the filter text? Name or description, case-insensitive substring. */
export function menuMatches(
  item: { name: string; description?: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return item.name.toLowerCase().includes(q) || (item.description ?? "").toLowerCase().includes(q);
}
