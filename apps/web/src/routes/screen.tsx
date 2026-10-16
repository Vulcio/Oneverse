import { formatScreenCode, lyricSlides, renderChart, screenThemeTemplate, type ScreenCurrent, type ScreenTheme, type SyncPresenting, type SyncStage } from "@songverse/core";
import { createFileRoute } from "@tanstack/react-router";
import { Music2, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { renderSVG } from "uqr";
import { LocaleProvider } from "@songverse/app/components/locale-provider";
import { ScreenSetPicker } from "#/components/screen-set-picker";
import { ScreenStage, type StageSong } from "#/components/screen-stage";
import type { StageLive } from "#/components/screen-widgets";
import { loadLocale } from "@songverse/app/i18n";
import { useScreenDisplay } from "#/lib/screen-display";
import { getVisitorLocale } from "@songverse/app/server-auth";
import { setlistTitle } from "#/lib/setlists";

/**
 * A big screen (issue #186): open songverse.one/screen on whatever drives
 * it - a TV's browser, a laptop on HDMI, the Google TV app (#187). No
 * sign-in: it shows a code and a QR code until someone who leads a set
 * confirms it from their phone; then it shows what's presented from Live -
 * the lyrics two lines at a time, or the chart - and goes black on demand,
 * in the look its theme gives it (issue #194). `?theme=concert` shows a
 * built-in theme instead, on this device: to try one, or for a browser
 * source in streaming software.
 */
export const Route = createFileRoute("/screen")({
  validateSearch: (search: Record<string, unknown>): { theme?: string } =>
    typeof search.theme === "string" && screenThemeTemplate(search.theme) ? { theme: search.theme } : {},
  beforeLoad: async () => ({ locale: await loadLocale(await getVisitorLocale()) }),
  head: () => ({ meta: [{ title: "Songverse screen" }] }),
  component: ScreenPage,
});

function ScreenPage() {
  const { locale } = Route.useRouteContext();
  return (
    <LocaleProvider locale={locale}>
      <ScreenDisplay />
    </LocaleProvider>
  );
}

function ScreenDisplay() {
  const state = useScreenDisplay();
  const { theme: pinned } = Route.useSearch();
  useWakeLock();
  return (
    // Black under everything: what's on a projector is the words, not the page.
    <div className="fixed inset-0 cursor-none overflow-hidden bg-black text-white select-none" data-testid="screen-display" data-state={state.kind}>
      {state.kind === "pairing" ? <Pairing code={state.code} /> : null}
      {state.kind === "showing" ? (
        <Showing current={state.current} presenting={state.presenting} online={state.online} stage={state.stage} offset={state.offset} theme={screenThemeTemplate(pinned)?.theme ?? state.current.theme} />
      ) : null}
    </div>
  );
}

/** The code to type, and a QR code to scan that opens the phone's page with it. */
function Pairing({ code }: { code: string }) {
  const { t } = useTranslation();
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/screens?code=${code}`;
  const qr = useMemo(() => (link ? renderSVG(link, { pixelSize: 8, whiteColor: "#ffffff", blackColor: "#000000" }) : ""), [link]);
  return (
    <div className="flex size-full flex-col items-center justify-center gap-[4vh] p-[5vmin] text-center" data-testid="screen-pairing">
      <p className="flex items-center gap-3 text-[3vmin] font-semibold text-neutral-300">
        <Music2 className="size-[4vmin]" aria-hidden />
        Songverse
      </p>
      <div className="flex flex-wrap items-center justify-center gap-[6vmin]">
        {/* The QR code on white, for any phone's camera. */}
        <div className="size-[34vmin] rounded-[2vmin] bg-white p-[2vmin] [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} data-testid="screen-qr" data-link={link} />
        <div className="flex flex-col items-center gap-[2vmin]">
          <p className="text-[3vmin] text-neutral-400">{t("screens.displayCodeLabel")}</p>
          <p className="font-mono text-[11vmin] leading-none font-bold tracking-[0.15em]" data-testid="screen-code">
            {formatScreenCode(code)}
          </p>
          <p className="max-w-[60vmin] text-[2.4vmin] text-neutral-400">{t("screens.displayCodeHint", { host: typeof window === "undefined" ? "" : window.location.host })}</p>
        </div>
      </div>
    </div>
  );
}

function Showing({ current, presenting, online, stage, offset, theme }: { current: ScreenCurrent; presenting: SyncPresenting | null; online: boolean; stage: SyncStage | null; offset: number; theme: ScreenTheme }) {
  const { t, i18n } = useTranslation();
  const set = current.set;
  const view = presenting && set ? set.songs.find((song) => song.item.id === presenting.itemId) : undefined;
  // A copy kept before themes (issue #194) has none: the default look.
  const look = theme ?? screenThemeTemplate("classic")!.theme;
  const song = useMemo<StageSong | null>(() => {
    if (!view?.song) return null;
    const chart = renderChart(view.song.document, view.arrangement?.document ?? null, { transposeSteps: view.item.transposeSteps, suggestedCapo: view.song.suggestedCapo });
    return { key: view.item.id, title: view.song.title, slides: lyricSlides(chart), credits: set?.credits[view.song.id], chart };
  }, [view, set]);

  // What the template's widgets read (issue #268): the song's details, the next song, when this item came on.
  const [itemStartedAt, setItemStartedAt] = useState<number | null>(null);
  useEffect(() => setItemStartedAt(presenting?.itemId ? Date.now() : null), [presenting?.itemId]);
  const live = useMemo<StageLive>(() => {
    const songs = set?.songs ?? [];
    const at = view ? songs.indexOf(view) : -1;
    const next = at >= 0 ? songs.slice(at + 1).find((one) => one.song) : undefined;
    const nextChart = next?.song ? renderChart(next.song.document, next.arrangement?.document ?? null, { transposeSteps: next.item.transposeSteps }) : null;
    return {
      details: view?.song && song ? { title: view.song.title, key: song.chart?.key ?? view.song.key, tempo: view.song.tempo } : null,
      nextSong: next?.song && nextChart ? { title: next.song.title, slides: lyricSlides(nextChart) } : null,
      // The set's items (issue #272): the one on screen and the one after, whatever they are.
      item: view && at >= 0 ? { title: view.song?.title ?? "", position: at + 1, count: songs.length } : null,
      nextItem: at >= 0 && songs[at + 1]?.song ? { title: songs[at + 1]!.song!.title } : null,
      itemStartedAt,
      // The media operator's (issue #269).
      operator: stage?.timer ?? null,
      message: stage?.message?.text ?? null,
      offset,
    };
  }, [set, view, song, itemStartedAt, stage, offset]);

  // Following its owner's schedule (issue #274): no set today, the sets to pick from; OK while nothing's presented opens them too.
  const daySet = current.screen.setMode === "DAY";
  const [picking, setPicking] = useState(false);
  const showPicker = daySet && (picking || !set);
  useEffect(() => {
    if (!daySet) return setPicking(false);
    // Open, the list takes the keys (OK on a set picks it).
    if (showPicker) return;
    const open = (event: KeyboardEvent) => {
      if ((event.key === "Enter" || event.key === " ") && !presenting) {
        event.preventDefault();
        setPicking(true);
      }
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, [daySet, presenting, showPicker]);
  // Picked: the set comes, the list goes.
  useEffect(() => setPicking(false), [current.screen.setlistId]);

  const idle = !set ? (
    <Idle title={current.screen.name} subtitle={t("screens.displayNoSet")} />
  ) : !presenting || !view ? (
    <Idle title={setlistTitle(set.set, t, i18n.language)} subtitle={daySet ? t("screens.picker.okHint") : current.screen.name} />
  ) : null;

  return (
    <div
      className="size-full"
      data-testid="screen-showing"
      data-mode={current.screen.mode}
      data-black={String(!!presenting?.black)}
      data-item={presenting?.itemId ?? ""}
      data-slide={presenting?.slide ?? ""}
      data-theme={current.screen.themeId ?? current.screen.themeTemplate ?? ""}
    >
      <ScreenStage
        className="size-full"
        theme={look}
        mode={current.screen.mode}
        song={idle ? null : song}
        slide={presenting?.slide ?? 0}
        black={!!presenting?.black}
        idle={idle}
        assets={current.assets}
        live={live}
      />
      {showPicker ? <ScreenSetPicker onClose={set ? () => setPicking(false) : undefined} /> : null}
      {/* Lost the connection: said quietly, in a corner; it comes back by itself. */}
      {!online ? <WifiOff className="absolute right-[2vmin] bottom-[2vmin] z-10 size-[3vmin] text-neutral-600" aria-label={t("screens.displayOffline")} /> : null}
    </div>
  );
}

function Idle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center gap-[2cqmin] opacity-60" data-testid="screen-idle">
      <p className="text-[6cqmin] font-semibold">{title}</p>
      <p className="text-[3cqmin]">{subtitle}</p>
    </div>
  );
}

/** Keeps the screen on while it's shown. */
function useWakeLock() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const request = () => {
      if (document.visibilityState === "visible")
        navigator.wakeLock
          .request("screen")
          .then((sentinel) => (lock = sentinel))
          .catch(() => undefined);
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      void lock?.release();
    };
  }, []);
}
