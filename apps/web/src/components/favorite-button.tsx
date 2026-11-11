import { Star } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { toast } from "@oneverse/ui/components/toast";
import { cn } from "@oneverse/ui/lib/utils";
import { setFavorite, useIsFavorite } from "#/lib/favorites";

/**
 * A star: the song in the user's favorites, or not (issue #81) - on a song's
 * page, on its card in the Library and in its preview (issue #434).
 * `onChange` hears a change the server took.
 */
export function FavoriteButton({
  songVersionId,
  initial,
  variant = "ghost",
  className,
  onChange,
}: {
  songVersionId: string;
  initial: boolean;
  /** `card`: small and round, over a cover. */
  variant?: "ghost" | "outline" | "card";
  className?: string;
  onChange?: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const on = useIsFavorite(songVersionId, initial);
  const [busy, setBusy] = useState(false);
  const label = on ? t("library.home.unfavorite") : t("library.home.favorite");
  return (
    <Button
      type="button"
      variant={variant === "card" ? "secondary" : variant}
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={busy}
      className={cn(variant === "card" && "size-7 rounded-full shadow-sm [&_svg]:size-3.5", className)}
      onClick={(event) => {
        // On a card, the click isn't the card's.
        event.preventDefault();
        event.stopPropagation();
        setBusy(true);
        setFavorite(songVersionId, !on)
          .then(() => onChange?.(!on))
          .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
          .finally(() => setBusy(false));
      }}
      data-testid="favorite-button"
    >
      <Star className={on ? "fill-amber-400 text-amber-500" : undefined} />
    </Button>
  );
}
