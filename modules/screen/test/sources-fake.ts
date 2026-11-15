// What the fake agenda, tenants, theming and notify answer the composed state (helpers.ts,
// `h.sources`), and which reads were made of them.
import type { DraftTheme, ThemeNow } from "../src/compose/sources.js";
import type { AgendaItem, AgendaNow, CheckinCode, VenueInfo } from "../src/compose/widgets.js";

export interface FakeSources {
  theme: ThemeNow | null;
  /** The event's theme revisions by number, as the pinned read answers them. */
  revisions: Record<number, ThemeNow>;
  /** The revision read fails (a 500, a timeout) while the current read may still answer. */
  revisionsDown: boolean;
  /** Theming's drafts by preview key; a key not here is one theming no longer knows. */
  drafts: Record<string, DraftTheme>;
  /** The draft read fails (theming does not answer). */
  draftsDown: boolean;
  event: { name: string } | null;
  agenda: AgendaNow | null;
  /** The whole run of show (`GET /internal/agenda/items`); null is "down". */
  agendaItems: AgendaItem[] | null;
  /** The run of show as kept for the screens' agenda version (`agendaDay`); null when none is. */
  agendaDay: AgendaItem[] | null;
  venue: VenueInfo | null;
  /** The hostnames the guest read (event) was made with. */
  hosts: string[];
  /** The tenant ids the module reads (theme, now and next, venue info) were made for. */
  tenants: string[];
  checkin: CheckinCode | null;
  /** The purposes notify's check-in code was read for. */
  checkinReads: string[];
  /** Notify's count of check-ins; null is "down". */
  checkins: number | null;
  /** The purposes the count was read for. */
  countReads: string[];
}

/** Every source down or empty, and nothing read yet. */
export function emptySources(): FakeSources {
  return {
    theme: null,
    revisions: {},
    revisionsDown: false,
    draftsDown: false,
    drafts: {},
    event: null,
    agenda: null,
    agendaItems: null,
    agendaDay: null,
    venue: null,
    hosts: [],
    tenants: [],
    checkin: null,
    checkinReads: [],
    checkins: null,
    countReads: [],
  };
}
