// Localization: the engine's string tables (assets/strings.json, English text
// as the keys, the nine StarHermit locales; en-GB, es-ES and fr-CA list only
// their differences) in the interface language the runtime reports (the
// player's choice in Options › Language, else the account's preferred language
// or the device's). Every string is drawn through T() each frame, so a change
// shows on the next frame and never ends the table. The account lines are the
// engine's own `starhermit.*` strings.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { setTranslator } from "../js/lang.js";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));
export function currentLocale(): string { return strings.locale; }
export type Vars = Record<string, string | number>;
/** An English source string in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string { return strings.t(key, vars ?? undefined); }
setTranslator(T); // the game modules' T (js/lang.js)
/** Marks an English key that is translated with T() where it is shown. */
export const N = (s: string): string => s;
const ACCOUNT = {
  signIn: "signIn", invite: "invite", inviteCopied: "inviteCopied", inviteLink: "inviteLink", signedOut: "signedOut",
  lbPosting: "leaderboardPosting", lbRank: "leaderboardRank", lbPosted: "leaderboardPosted", lbNotPosted: "leaderboardNotPosted",
} as const;
/** An account line (the engine's) in the player's language. */
export function S(key: keyof typeof ACCOUNT, vars?: Vars): string { return strings.t(`starhermit.${ACCOUNT[key]}`, vars); }
/** ui.js fmtChips: chip counts are grouped the same in every language (en-US). */
export function chips(n: number): string {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return v < 0 ? "-" + s : s;
}
