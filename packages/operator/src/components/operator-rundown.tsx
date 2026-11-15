import { passName, slideKey, type RenderedChart, type ScreenSlide, type SetlistOfflineCopy, type SyncPresenting } from "@oneverse/core";
import { MonitorUp } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { cn } from "@oneverse/ui/lib/utils";
import { setItemTitle, setItemView } from "@oneverse/screen/lib/set-items";
import { useLive, useOperatorHost } from "../host";

/** A set item as the console steps through it (issues #277, #358): its slides, what they say, its sections' first slides. */
export interface OperatorItem {
  itemId: string;
  title: string;
  chart: RenderedChart | null;
  slides: ScreenSlide[];
  /** What its slides say (issue #247), sent with what's presented. */
  key: string;
  /** Each pass of the song, by the slide it starts on (issue #358): what the section jumps go to. */
  sections: { label: string; slide: number; type: string }[];
}

/** The set's items as the console steps through them, cut as the screens cut them. */
export function useOperatorItems(copy: SetlistOfflineCopy): OperatorItem[] {
  const { t } = useTranslation();
  return useMemo(
    () =>
      copy.songs.map((view) => {
        const { chart, slides } = setItemView(view);
        const sections: OperatorItem["sections"] = [];
        slides.forEach((slide, index) => {
          if (index > 0 && slides[index - 1]!.passIndex === slide.passIndex) return;
          const pass = chart?.passes[slide.passIndex];
          if (pass) sections.push({ label: passName(pass, pass.section, pass.section.number, (type) => t(`chart.sections.${type}`)) ?? t(`chart.sections.${pass.section.type}`), slide: index, type: pass.section.type });
        });
        return { itemId: view.item.id, title: setItemTitle(view, t), chart, slides, key: slideKey(slides), sections };
      }),
    [copy, t],
  );
}

/**
 * The slide the screens go to next (issue #358): the one after what's on
 * them, into the next item with slides past a song's last; with nothing up,
 * the first slide of the item looked at.
 */
export function nextSlide(items: OperatorItem[], presenting: Pick<SyncPresenting, "itemId" | "slide"> | null, lookedAt: string | null): { item: OperatorItem; slide: number } | null {
  if (!presenting) {
    const item = items.find((one) => one.itemId === lookedAt) ?? items.find((one) => one.slides.length > 0);
    return item?.slides.length ? { item, slide: 0 } : null;
  }
  const at = items.findIndex((one) => one.itemId === presenting.itemId);
  if (at < 0) return null;
  if (presenting.slide + 1 < items[at]!.slides.length) return { item: items[at]!, slide: presenting.slide + 1 };
  const item = items.slice(at + 1).find((one) => one.slides.length > 0);
  return item ? { item, slide: 0 } : null;
}

/**
 * The set's running order (issue #358): every item, the one on the screens
 * marked live, the one looked at picked out. A row looks at its item; its
 * button puts it up. `strip`: one scrolling row, for a narrow console.
 */
export function Rundown({ items, itemId, onLook, strip = false }: { items: OperatorItem[]; itemId: string | null; onLook: (itemId: string) => void; strip?: boolean }) {
  const { t } = useTranslation();
  const { session, canPresent } = useLive();
  const { present } = useOperatorHost();
  const presenting = session?.presenting ?? null;
  const putUp = (item: OperatorItem) => {
    present({ itemId: item.itemId, slide: 0, black: false, slideKey: item.key });
    if (item.itemId !== itemId) onLook(item.itemId);
  };
  if (strip) {
    return (
      <nav aria-label={t("screens.operator.rundown")} className="-mx-1 overflow-x-auto px-1 pb-1" data-testid="operator-rundown" data-strip="">
        <ol className="flex gap-2">
          {items.map((item, index) => {
            const live = presenting?.itemId === item.itemId;
            return (
              <li key={item.itemId} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onLook(item.itemId)}
                  aria-current={item.itemId === itemId ? "true" : undefined}
                  className={cn("flex max-w-56 items-center gap-2 rounded-full border px-3 py-1.5 text-sm", item.itemId === itemId ? "border-primary bg-primary/10" : "bg-card", live && "ring-2 ring-red-500/60")}
                  data-testid="operator-rundown-item"
                  data-live={live ? "" : undefined}
                >
                  <span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                  <span className="truncate">{item.title}</span>
                  {live ? <span className="size-2 shrink-0 rounded-full bg-red-500" aria-label={t("screens.operator.live")} /> : null}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    );
  }
  return (
    <nav aria-label={t("screens.operator.rundown")} className="flex min-w-0 flex-col gap-2" data-testid="operator-rundown">
      <h2 className="text-sm font-semibold">{t("screens.operator.rundown")}</h2>
      <ol className="flex flex-col gap-1">
        {items.map((item, index) => {
          const live = presenting?.itemId === item.itemId;
          const looked = item.itemId === itemId;
          return (
            <li key={item.itemId} className={cn("group flex items-center gap-1 rounded-md border", looked ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted", live && "border-red-500/60")}>
              <button type="button" onClick={() => onLook(item.itemId)} aria-current={looked ? "true" : undefined} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm" data-testid="operator-rundown-item" data-live={live ? "" : undefined}>
                <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {live ? (
                      <span className="font-medium text-red-600 dark:text-red-400">
                        {t("screens.operator.live")} · {t("screens.slideOf", { slide: (presenting?.slide ?? 0) + 1, count: item.slides.length })}
                      </span>
                    ) : (
                      t("screens.operator.slideCount", { count: item.slides.length })
                    )}
                  </span>
                </span>
              </button>
              <Button
                size="icon"
                variant="ghost"
                className="mr-1 size-8 shrink-0"
                disabled={!canPresent || item.slides.length === 0}
                onClick={() => putUp(item)}
                title={t("screens.operator.putUp")}
                aria-label={t("screens.operator.putUpItem", { title: item.title })}
                data-testid="operator-rundown-present"
              >
                <MonitorUp />
              </Button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
