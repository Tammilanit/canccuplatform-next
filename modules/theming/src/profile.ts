/** Where the event profile's `theme` comes from (contracts/theming.md, Tenancy). */
import type { PartialTokens } from "./tokens.js";

/** The profile's `theme` of one event, or undefined when it sets none. */
export type ProfileSource = (tenant: string) => Promise<PartialTokens | undefined>;

/**
 * No module can read the profile yet: admin's only read is the zip export, for people holding
 * `admin.profile.read`. Until a contract read exists (a question on PR #232), revision 0 is the
 * platform defaults.
 */
export const noProfile: ProfileSource = () => Promise.resolve(undefined);
