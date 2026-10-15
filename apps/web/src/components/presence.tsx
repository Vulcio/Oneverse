import type { SongActivity, SongPresence } from "@songverse/core";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { cn } from "@songverse/ui/lib/utils";
import { PersonAvatar } from "#/components/person-avatar";

/** Names in a sentence, in the reader's language: "Sam", "Sam and Ana", "Sam, Ana and Jo". */
function namesOf(people: SongPresence[], locale: string): string {
  const names = [...new Set(people.map((person) => person.name))];
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names);
}

/**
 * Who else is in the song (issue #27): "Sam is editing this song", "Ana is
 * replying…", with their avatars; nothing when nobody is.
 */
export function PresenceChip({ people, doing, className }: { people: SongPresence[]; doing: SongActivity; className?: string }) {
  const { t, i18n } = useTranslation();
  const these = people.filter((person) => person.doing === doing);
  if (these.length === 0) return null;
  const unique = [...new Map(these.map((person) => [person.userId, person])).values()];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)} data-testid={`presence-${doing}`} role="status">
      <span className="flex -space-x-1">
        {unique.slice(0, 3).map((person) => (
          <PersonAvatar key={person.userId} name={person.name} avatarUrl={person.avatarUrl ?? null} size={18} className="ring-2 ring-background" />
        ))}
      </span>
      {t(`presence.${doing}`, { count: unique.length, names: namesOf(unique, i18n.language) })}
    </span>
  );
}

/** Someone saved the song while it's open here (issue #27), or a save was refused for it: load theirs, or carry on. */
export function SavedElsewhere({
  by,
  dirty,
  onLoad,
  onDismiss,
}: {
  /** Who saved it; null when only the refused save says so. */
  by: string | null;
  /** Edits not saved here: loading theirs drops them. */
  dirty: boolean;
  onLoad: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    // Over the page, not in it: nothing moves under the one editing.
    <div
      className="fixed inset-x-4 bottom-[calc(var(--save-bar-h,0px)+1rem)] z-50 mx-auto flex max-w-xl flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
      role="alert"
      data-testid="saved-elsewhere"
    >
      <p className="min-w-0 flex-1">
        {by ? t("presence.savedBy", { name: by }) : t("presence.savedSomewhere")}
        {dirty ? <span className="block text-xs text-muted-foreground">{t("presence.yoursUnsaved")}</span> : null}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onDismiss} data-testid="saved-elsewhere-dismiss">
          {t("presence.keepEditing")}
        </Button>
        <Button size="sm" onClick={onLoad} data-testid="saved-elsewhere-load">
          {dirty ? t("presence.dropAndLoad") : t("presence.load")}
        </Button>
      </div>
    </div>
  );
}

/** The song changed outside the room one was typing in (issue #27): loaded again, what nobody saved dropped. */
export function StartedOver({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-x-4 bottom-[calc(var(--save-bar-h,0px)+1rem)] z-50 mx-auto flex max-w-xl items-center gap-3 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
      role="status"
      data-testid="started-over"
    >
      <p className="min-w-0 flex-1">{t("presence.startedOver")}</p>
      <Button size="sm" variant="outline" onClick={onDismiss}>
        {t("presence.gotIt")}
      </Button>
    </div>
  );
}
