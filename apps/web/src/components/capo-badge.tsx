import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@songverse/ui/lib/utils";

/**
 * A song's capo, hard to miss (issue #219): a red pill with a warning sign -
 * "Capo 1" - and, when its chords are written as the shapes played with
 * the capo on (in italics), "chords as shapes".
 */
export function CapoBadge({ capo, shapes, suggested, className }: { capo: number; shapes: boolean; suggested?: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn("inline-flex w-fit items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground", className)}
      data-testid="capo-badge"
      data-shapes={shapes ? "" : undefined}
    >
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
      {suggested ? t("player.suggestedCapo", { capo }) : t("player.capo", { capo })}
      {shapes ? <span className="font-normal italic">· {t("player.capoChordsAsShapes")}</span> : null}
    </span>
  );
}
