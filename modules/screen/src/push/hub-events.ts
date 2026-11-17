/** Which events of the tenant streams make the hub (hub.ts) rebuild, recheck or end streams. */

/** Events after which a zone may draw something else. */
const REBUILDS = [
  "screen.zone.saved",
  "screen.ticker.changed",
  "screen.content.",
  "screen.photo.",
  "screen.pin.changed",
  "agenda.item.",
  "agenda.items.",
  "agenda.kind.",
  "tenants.tenant.changed",
  "tenants.status.changed",
  "tenants.venue_info.changed",
  "theming.theme.published",
  // Main hands these on only once src/compose/overrides.ts, scenes.ts and src/moments-sound.ts
  // have kept them.
  "moments.override.",
  "moments.sound.",
  "moments.scene.",
  "moments.prefetch.",
];
/** The event's context changed: every stream checks its device again and may redraw. */
export const RECHECKS = new Set([
  "tenants.tenant.changed",
  "tenants.status.changed",
  "tenants.venue_ip_check.changed",
  "tenants.venue.changed",
]);
/** The device no longer serves this event, or its token stopped: its streams end. */
export const ENDS = new Set([
  "screen.device.revoked",
  "screen.device.released",
  "screen.device.moved",
]);

export function rebuilds(type: string): boolean {
  return REBUILDS.some((p) => (p.endsWith(".") ? type.startsWith(p) : type === p));
}
