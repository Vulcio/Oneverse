import { SCREEN_THEME_TEMPLATES } from "@songverse/core";
import { Check, ChevronLeft, ListMusic, Palette, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { fetchScreenThemes, pickScreenTheme, type ScreenThemeOptions } from "#/lib/screen-display";
import { useRemoteList } from "#/lib/screen-remote";
import { cn } from "@songverse/ui/lib/utils";

const entry = "flex w-full items-center gap-[2vmin] rounded-[1.2vmin] px-[2.5vmin] py-[1.6vmin] text-left text-[3.2vmin] outline-none hover:bg-white/15 focus:bg-white focus:text-black disabled:opacity-50";

/**
 * A screen's own menu (issue #276), opened on the screen itself - OK held, a
 * double-click, a right-click or a long press - even while a set is showing:
 * another set (on a screen following the day's set; a fixed one keeps the
 * set put on it from Screens), and another theme, kept on the screen.
 */
export function ScreenMenu({ daySet, onChooseSet, onClose }: { daySet: boolean; onChooseSet: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [view, setView] = useState<"menu" | "themes">("menu");
  const [themes, setThemes] = useState<ScreenThemeOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useRemoteList(list, view === "themes" ? () => setView("menu") : onClose);

  useEffect(() => {
    void fetchScreenThemes().then(setThemes);
  }, []);
  // Each view opens on its first entry, or the theme the screen has.
  useEffect(() => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("[data-pick]:not(:disabled)") ?? [])];
    (buttons.find((one) => one.dataset.current !== undefined) ?? buttons[0])?.focus();
  }, [view, themes]);

  const currentName = !themes
    ? ""
    : themes.themeId
      ? (themes.themes.find((one) => one.id === themes.themeId)?.name ?? "")
      : t(`screens.templates.${themes.themeTemplate ?? "classic"}.name`);
  const pick = async (choice: { themeId: string | null; themeTemplate: string | null }) => {
    setBusy(true);
    if (await pickScreenTheme(choice)) onClose();
    setBusy(false);
  };
  const themeRow = (key: string, label: ReactNode, current: boolean, choice: { themeId: string | null; themeTemplate: string | null }, detail?: string | null) => (
    <button key={key} type="button" data-pick={key} data-current={current ? "" : undefined} disabled={busy} onClick={() => void pick(choice)} className={cn(entry, current && "ring-[0.3vmin] ring-white/50")} data-testid="screen-menu-theme">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail ? <span className="shrink-0 text-[2.2vmin] opacity-60">{detail}</span> : null}
      {current ? <Check className="size-[3.2vmin] shrink-0" aria-label={t("screens.menu.current")} /> : null}
    </button>
  );
  const heading = (text: string) => <p className="px-[2.5vmin] pt-[2vmin] pb-[0.5vmin] text-[2.2vmin] font-semibold tracking-[0.12em] uppercase opacity-50">{text}</p>;

  return (
    <div className="absolute inset-0 z-20 flex cursor-default items-center justify-center bg-black/90 p-[5vmin]" data-testid="screen-menu" data-view={view}>
      <div className="flex max-h-full w-[min(90vw,110vmin)] flex-col gap-[2vmin]">
        <div>
          <p className="text-[4.5vmin] font-semibold">{view === "menu" ? t("screens.menu.title") : t("screens.menu.themesTitle")}</p>
          <p className="text-[2.4vmin] opacity-60">{t("screens.menu.hint")}</p>
        </div>
        <div ref={list} className="min-h-0 overflow-y-auto pr-[1vmin]">
          {view === "menu" ? (
            <>
              <button type="button" data-pick="set" disabled={!daySet} onClick={onChooseSet} className={entry} data-testid="screen-menu-set">
                <ListMusic className="size-[3.2vmin] shrink-0 opacity-60" aria-hidden />
                <span className="min-w-0 flex-1">{t("screens.menu.chooseSet")}</span>
              </button>
              {!daySet ? <p className="px-[2.5vmin] pb-[1vmin] text-[2.2vmin] opacity-60">{t("screens.menu.fixedSet")}</p> : null}
              <button type="button" data-pick="themes" onClick={() => setView("themes")} className={entry} data-testid="screen-menu-themes">
                <Palette className="size-[3.2vmin] shrink-0 opacity-60" aria-hidden />
                <span className="min-w-0 flex-1">{t("screens.menu.theme")}</span>
                <span className="shrink-0 text-[2.4vmin] opacity-60">{currentName}</span>
              </button>
              <button type="button" data-pick="close" onClick={onClose} className={entry} data-testid="screen-menu-close">
                <X className="size-[3.2vmin] shrink-0 opacity-60" aria-hidden />
                {t("screens.menu.close")}
              </button>
            </>
          ) : (
            <>
              <button type="button" data-pick="back" onClick={() => setView("menu")} className={entry} data-testid="screen-menu-back">
                <ChevronLeft className="size-[3.2vmin] shrink-0 opacity-60" aria-hidden />
                {t("screens.menu.back")}
              </button>
              {heading(t("screens.menu.builtIn"))}
              {SCREEN_THEME_TEMPLATES.map((one) =>
                themeRow(one.id, t(`screens.templates.${one.id}.name`), !!themes && !themes.themeId && (themes.themeTemplate ?? "classic") === one.id, { themeId: null, themeTemplate: one.id }),
              )}
              {themes && themes.themes.length > 0 ? (
                <>
                  {heading(t("screens.menu.saved"))}
                  {themes.themes.map((one) => themeRow(one.id, one.name, themes.themeId === one.id, { themeId: one.id, themeTemplate: null }, one.teamName))}
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
