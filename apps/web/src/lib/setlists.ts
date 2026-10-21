import { transposeKey, type SetlistSummary } from "@oneverse/core";
import type { TFunction } from "i18next";


export { formatSetDate, formatSetDay } from "@oneverse/ui/lib/dates";
// A set's and its items' titles, and an item as the screens cut it: shared with the screen (issue #305).
export { setItemTitle, setItemView, setlistTitle } from "@oneverse/screen/lib/set-items";

/** The team's name, "Personal", or for a set shared with you, who shared it. */
export function setOwnerLabel(set: Pick<SetlistSummary, "teamName" | "ownerName" | "isGuest">, t: TFunction): string {
  if (set.teamName) return set.teamName;
  if (set.isGuest && set.ownerName) return t("sets.sharedWithYouBy", { name: set.ownerName });
  return t("sets.personal");
}

function signed(steps: number): string {
  return steps > 0 ? `+${steps}` : `−${Math.abs(steps)}`;
}

/** e.g. "A (+2)" or "G (original)"; "+2 semitones" when the song has no recognizable key. */
export function transposeLabel(key: string | null, steps: number, t: TFunction): string {
  const target = key ? transposeKey(key, steps) : null;
  if (target) return steps === 0 ? `${target} (${t("sets.original")})` : `${target} (${signed(steps)})`;
  return steps === 0 ? t("sets.originalKey") : t("sets.semitones", { shift: signed(steps) });
}

export function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
