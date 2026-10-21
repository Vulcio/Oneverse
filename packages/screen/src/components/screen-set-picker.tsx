import { CalendarDays, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchScreenSets, pickScreenSet, type ScreenSetOption, type ScreenSets } from "../lib/screen-display";
import { useRemoteList } from "../lib/screen-remote";
import { setlistTitle } from "../lib/set-items";
import { cn } from "@oneverse/ui/lib/utils";

/**
 * A screen's sets to pick from (issue #274), with a TV remote - the D-pad
 * and OK, as a Chromecast's - or the arrow keys and Enter: today's and
 * upcoming ones first, then those without a date, then the archive (opened
 * on demand). Back (Escape) closes it, when there's a set to go back to.
 */
export function ScreenSetPicker({ onClose }: { onClose?: () => void }) {
  const { t, i18n } = useTranslation();
  const [sets, setSets] = useState<ScreenSets | null>(null);
  const [archive, setArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchScreenSets().then(setSets);
  }, []);
  // The set it shows focused, else the first: OK picks it straight away.
  useEffect(() => {
    if (!sets) return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("[data-pick]") ?? [])];
    (buttons.find((one) => one.dataset.pick === sets.setlistId) ?? buttons[0])?.focus();
  }, [sets]);

  // The archive opened: its latest set focused.
  useEffect(() => {
    if (archive) list.current?.querySelector<HTMLButtonElement>("[data-archive] [data-pick]")?.focus();
  }, [archive]);

  useRemoteList(list, onClose);

  const pick = async (setlistId: string | null) => {
    setBusy(true);
    // The server tells the screen, which loads the set; until then, this stays.
    if (await pickScreenSet(setlistId)) onClose?.();
    setBusy(false);
  };

  const row = (set: ScreenSetOption) => (
    <button
      key={set.id}
      type="button"
      data-pick={set.id}
      disabled={busy}
      onClick={() => void pick(set.id)}
      className={cn(
        "flex w-full items-center gap-[2vmin] rounded-[1.2vmin] px-[2.5vmin] py-[1.6vmin] text-left text-[3.2vmin] outline-none",
        "focus:bg-white focus:text-black hover:bg-white/15",
        set.id === sets?.setlistId && "ring-[0.3vmin] ring-white/50",
      )}
      data-testid="screen-pick-set"
    >
      <CalendarDays className="size-[3.2vmin] shrink-0 opacity-60" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{setlistTitle({ name: set.name, eventDate: set.eventDate, fromEvent: set.fromEvent }, t, i18n.language)}</span>
      {set.teamName ? <span className="shrink-0 text-[2.2vmin] opacity-60">{set.teamName}</span> : null}
    </button>
  );
  const heading = (text: string) => <p className="px-[2.5vmin] pt-[2vmin] pb-[0.5vmin] text-[2.2vmin] font-semibold tracking-[0.12em] uppercase opacity-50">{text}</p>;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/90 p-[5vmin]" data-testid="screen-set-picker">
      <div className="flex max-h-full w-[min(90vw,110vmin)] flex-col gap-[2vmin]">
        <div>
          <p className="text-[4.5vmin] font-semibold">{t("screens.picker.title")}</p>
          <p className="text-[2.4vmin] opacity-60">{t("screens.picker.hint")}</p>
        </div>
        <div ref={list} className="min-h-0 overflow-y-auto pr-[1vmin]">
          {!sets ? <p className="text-[3vmin] opacity-60">{t("screens.picker.loading")}</p> : null}
          {sets?.picked ? (
            <button
              type="button"
              data-pick="__day__"
              onClick={() => void pick(null)}
              className="flex w-full items-center gap-[2vmin] rounded-[1.2vmin] px-[2.5vmin] py-[1.6vmin] text-left text-[3.2vmin] outline-none hover:bg-white/15 focus:bg-white focus:text-black"
              data-testid="screen-pick-day"
            >
              <Undo2 className="size-[3.2vmin] shrink-0 opacity-60" aria-hidden />
              {t("screens.picker.backToDay")}
            </button>
          ) : null}
          {sets && sets.upcoming.length > 0 ? (
            <>
              {heading(t("screens.picker.upcoming"))}
              {sets.upcoming.map(row)}
            </>
          ) : null}
          {sets && sets.undated.length > 0 ? (
            <>
              {heading(t("screens.picker.undated"))}
              {sets.undated.map(row)}
            </>
          ) : null}
          {sets && sets.archive.length > 0 ? (
            archive ? (
              <div data-archive>
                {heading(t("screens.picker.archive"))}
                {sets.archive.map(row)}
              </div>
            ) : (
              <button
                type="button"
                data-pick="__archive__"
                onClick={() => setArchive(true)}
                className="mt-[1vmin] flex w-full items-center rounded-[1.2vmin] px-[2.5vmin] py-[1.6vmin] text-left text-[2.8vmin] opacity-80 outline-none hover:bg-white/15 focus:bg-white focus:text-black focus:opacity-100"
                data-testid="screen-pick-archive"
              >
                {t("screens.picker.showArchive", { count: sets.archive.length })}
              </button>
            )
          ) : null}
          {sets && sets.upcoming.length + sets.undated.length + sets.archive.length === 0 ? <p className="text-[3vmin] opacity-60">{t("screens.picker.none")}</p> : null}
        </div>
      </div>
    </div>
  );
}
