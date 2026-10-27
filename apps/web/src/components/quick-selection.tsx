import { ListChecks, ListPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@oneverse/ui/lib/utils";
import { addToQuickSelection, inQuickSelection, removeFromQuickSelection, useQuickSelection } from "#/lib/quick-selection";

/**
 * A song in or out of the Quick selection (issue #334), as a small button:
 * on a row of the library's Songs. Clicking it doesn't open the song.
 */
export function QuickSelectToggle({ songVersionId, className }: { songVersionId: string; className?: string }) {
  const { t } = useTranslation();
  const selection = useQuickSelection();
  const [busy, setBusy] = useState(false);
  const selected = inQuickSelection(selection, songVersionId);
  const label = selected ? t("quickSelection.remove") : t("quickSelection.add");
  return (
    <button
      type="button"
      disabled={busy || !selection}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        setBusy(true);
        void (selected ? removeFromQuickSelection(songVersionId) : addToQuickSelection(songVersionId)).finally(() => setBusy(false));
      }}
      className={cn(
        "flex size-8 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [&_svg]:size-4",
        selected ? "text-primary" : "text-muted-foreground",
        className,
      )}
      data-testid="quick-select-toggle"
    >
      {selected ? <ListChecks /> : <ListPlus />}
    </button>
  );
}
