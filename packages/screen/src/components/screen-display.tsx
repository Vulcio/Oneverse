import { composeBuiltInTemplate, formatScreenCode, screenBuiltInTemplate, screenLayers, slideKey, type ScreenCurrent, type ScreenTheme, type SyncPresenting, type SyncStage } from "@oneverse/core";
import { ChevronLeft, Music2, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { renderSVG } from "uqr";
import { ScreenMenu } from "./screen-menu";
import { ScreenSetPicker } from "./screen-set-picker";
import { ScreenStage, type StageSong } from "./screen-stage";
import type { StageLive } from "./screen-widgets";
import { stopPairingAgain, useScreenDisplay } from "../lib/screen-display";
import { passageCredit, setItemTitle, setItemView, setlistTitle } from "../lib/set-items";

/**
 * A big screen (issues #186, #305): whatever drives it - a TV's browser, a
 * laptop on HDMI, the Google TV app (#187) - opens the screen app. No
 * sign-in: it shows a code and a QR code until someone who leads a set
 * confirms it on Songverse's Screens page (`pairUrl`, Songverse's address);
 * then it shows what's presented - the words a slide at a time, or the
 * chart - and goes black on demand, in the look its theme gives it (issue
 * #194). `pinnedTheme` shows a built-in theme instead, on this device: to
 * try one, or for a browser source in streaming software.
 */
export function ScreenDisplay({ pairUrl, pinnedTheme }: { pairUrl: string; pinnedTheme?: string }) {
  const state = useScreenDisplay();
  const pinned = pinnedTheme && screenBuiltInTemplate(pinnedTheme) ? pinnedTheme : undefined;
  useWakeLock();
  return (
    // Black under everything: what's on a projector is the words, not the page.
    <div className="fixed inset-0 cursor-none overflow-hidden bg-black text-white select-none" data-testid="screen-display" data-state={state.kind}>
      {state.kind === "pairing" ? <Pairing code={state.code} pairUrl={pairUrl} adding={state.adding} /> : null}
      {state.kind === "showing" ? (
        <Showing current={state.current} presenting={state.presenting} online={state.online} stage={state.stage} offset={state.offset} theme={(pinned && composeBuiltInTemplate(pinned, { effects: state.current.screen.effects !== false })) || state.current.theme} itemThemes={pinned ? undefined : state.current.itemThemes} />
      ) : null}
    </div>
  );
}

/**
 * The code to type, and a QR code to scan that opens the phone's page with it: Songverse's Screens.
 * `adding`: for another profile (issue #284) - Back, or the remote's, returns to the one it showed.
 */
function Pairing({ code, pairUrl, adding }: { code: string; pairUrl: string; adding: boolean }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!adding) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Backspace" || event.key === "GoBack" || event.key === "BrowserBack") stopPairingAgain();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding]);
  const base = pairUrl.replace(/\/+$/, "");
  const link = `${base}/screens?code=${code}`;
  const qr = useMemo(() => (link ? renderSVG(link, { pixelSize: 8, whiteColor: "#ffffff", blackColor: "#000000" }) : ""), [link]);
  return (
    <div className="flex size-full flex-col items-center justify-center gap-[4vh] p-[5vmin] text-center" data-testid="screen-pairing">
      <p className="flex items-center gap-3 text-[3vmin] font-semibold text-neutral-300">
        <Music2 className="size-[4vmin]" aria-hidden />
        Oneverse
      </p>
      <div className="flex flex-wrap items-center justify-center gap-[6vmin]">
        {/* The QR code on white, for any phone's camera. */}
        <div className="size-[34vmin] rounded-[2vmin] bg-white p-[2vmin] [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} data-testid="screen-qr" data-link={link} />
        <div className="flex flex-col items-center gap-[2vmin]">
          <p className="text-[3vmin] text-neutral-400">{adding ? t("screens.displayAddingLabel") : t("screens.displayCodeLabel")}</p>
          <p className="font-mono text-[11vmin] leading-none font-bold tracking-[0.15em]" data-testid="screen-code">
            {formatScreenCode(code)}
          </p>
          <p className="max-w-[60vmin] text-[2.4vmin] text-neutral-400">{t("screens.displayCodeHint", { host: base.replace(/^[a-z]+:\/\//, "") })}</p>
        </div>
      </div>
      {adding ? (
        <button type="button" onClick={stopPairingAgain} className="flex cursor-default items-center gap-[1.5vmin] rounded-[1.2vmin] px-[2.5vmin] py-[1.4vmin] text-[2.8vmin] text-neutral-300 outline-none hover:bg-white/15 focus:bg-white focus:text-black" data-testid="screen-pairing-back">
          <ChevronLeft className="size-[3vmin]" aria-hidden />
          {t("screens.displayAddingBack")}
        </button>
      ) : null}
    </div>
  );
}

function Showing({
  current,
  presenting,
  online,
  stage,
  offset,
  theme,
  itemThemes,
}: {
  current: ScreenCurrent;
  presenting: SyncPresenting | null;
  online: boolean;
  stage: SyncStage | null;
  offset: number;
  theme: ScreenTheme;
  itemThemes?: Record<string, ScreenTheme>;
}) {
  const { t, i18n } = useTranslation();
  const set = current.set;
  const view = presenting && set ? set.songs.find((song) => song.item.id === presenting.itemId) : undefined;
  // A passage with a template of its own (issue #310) is shown with it; anything else, the screen's. A copy kept
  // before themes (issue #194) has none: the default look.
  const look = (view && itemThemes?.[view.item.id]) || theme || composeBuiltInTemplate("classic")!;
  const song = useMemo<StageSong | null>(() => {
    if (!view || (!view.song && !view.text && !view.passage)) return null;
    const { chart, slides: cut } = setItemView(view);
    // Not the words the presenter's slides say (the song edited since, issue #247): no words rather than another slide's.
    const slides = presenting?.slideKey && slideKey(cut) !== presenting.slideKey ? cut.map((slide) => ({ ...slide, lines: [] })) : cut;
    return { key: view.item.id, title: setItemTitle(view, t), slides, credits: view.song ? set?.credits[view.song.id] : undefined, attribution: view.passage ? passageCredit(view.passage) : null, chart };
  }, [view, set, t, presenting?.slideKey]);

  // Each item's slides, counted once per set (issue #289): the Slide count widget's set.
  const slideCounts = useMemo(() => (set?.songs ?? []).map((one) => setItemView(one).slides.length), [set]);

  // What the template's widgets read (issue #268): the song's details, the next song, when this item came on.
  const [itemStartedAt, setItemStartedAt] = useState<number | null>(null);
  useEffect(() => setItemStartedAt(presenting?.itemId ? Date.now() : null), [presenting?.itemId]);
  const live = useMemo<StageLive>(() => {
    const songs = set?.songs ?? [];
    const at = view ? songs.indexOf(view) : -1;
    const next = at >= 0 ? songs.slice(at + 1).find((one) => one.song) : undefined;
    return {
      details: view?.song && song ? { title: view.song.title, key: song.chart?.key ?? view.song.key, tempo: view.song.tempo } : null,
      nextSong: next?.song ? { title: next.song.title, slides: setItemView(next).slides } : null,
      // The set's items (issue #272): the one on screen and the one after, whatever they are.
      item: view && at >= 0 ? { title: setItemTitle(view, t), position: at + 1, count: songs.length } : null,
      nextItem: at >= 0 && songs[at + 1] ? { title: setItemTitle(songs[at + 1]!, t) } : null,
      itemStartedAt,
      // The media operator's (issue #269).
      operator: stage?.timer ?? null,
      // The operator's layers, for this screen, less those it never shows (issues #280, #287).
      layers: screenLayers(stage?.layers, presenting, { id: current.screen.id, hidden: current.screen.hiddenLayers }),
      title: set ? { title: setlistTitle(set.set, t, i18n.language), subtitle: set.set.teamName ?? null } : null,
      setSlides: at >= 0 ? { counts: slideCounts, item: at } : null,
      message: stage?.message?.text ?? null,
      offset,
    };
  }, [set, view, song, itemStartedAt, stage, presenting, current.screen.id, current.screen.hiddenLayers, offset, slideCounts, t, i18n.language]);

  // Following its owner's schedule (issue #274): no set today, the sets to pick from; OK while nothing's presented opens them too.
  const daySet = current.screen.setMode === "DAY";
  const [picking, setPicking] = useState(false);
  const showPicker = daySet && (picking || !set);
  // The screen's own menu (issues #276, #285): OK pressed three times or held, the remote's Menu key, else a
  // double-click, a right-click or a long press - never a passing tap.
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!daySet) setPicking(false);
    // Open, the list takes the keys (OK on an entry picks it).
    if (showPicker || menu) return;
    let hold: ReturnType<typeof setTimeout> | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let presses = 0;
    const opensMenu = () => {
      clearTimeout(settle);
      presses = 0;
      setMenu(true);
    };
    const down = (event: KeyboardEvent) => {
      if (MENU_KEYS.includes(event.key)) {
        event.preventDefault();
        return opensMenu();
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (event.repeat || hold || event.key !== "Enter") return;
      hold = setTimeout(() => {
        hold = undefined;
        opensMenu();
      }, HOLD_MS);
    };
    // Short presses, counted: the third opens the menu; one alone, once no other follows, the sets (on a screen
    // following the day's with nothing presented).
    const up = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const short = event.key === " " || hold !== undefined;
      clearTimeout(hold);
      hold = undefined;
      if (!short) return;
      presses += 1;
      clearTimeout(settle);
      if (presses >= 3) return opensMenu();
      settle = setTimeout(() => {
        if (presses === 1 && daySet && !presenting) setPicking(true);
        presses = 0;
      }, PRESS_GAP_MS);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      clearTimeout(hold);
      clearTimeout(settle);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [daySet, presenting, showPicker, menu]);
  // Picked: the set comes, the list goes.
  useEffect(() => setPicking(false), [current.screen.setlistId]);
  const press = useLongPress(() => setMenu(true));

  const idle = !set ? (
    <Idle title={current.screen.name} subtitle={t("screens.displayNoSet")} />
  ) : !presenting || !view ? (
    <Idle title={setlistTitle(set.set, t, i18n.language)} subtitle={daySet ? t("screens.picker.okHint") : current.screen.name} />
  ) : null;

  return (
    <div
      className="size-full"
      data-testid="screen-showing"
      data-mode={look.shows === "chart" ? "CHART" : "LYRICS"}
      data-black={String(!!presenting?.black)}
      data-item={presenting?.itemId ?? ""}
      data-slide={presenting?.slide ?? ""}
      data-theme={current.screen.themeId ?? current.screen.themeTemplate ?? ""}
      data-item-theme={String(!!(view && itemThemes?.[view.item.id]))}
      onDoubleClick={() => !showPicker && setMenu(true)}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!showPicker) setMenu(true);
      }}
      {...press}
    >
      <ScreenStage
        className="size-full"
        theme={look}
        song={idle ? null : song}
        slide={presenting?.slide ?? 0}
        black={!!presenting?.black}
        idle={idle}
        assets={current.assets}
        live={live}
        videoInput
      />
      {showPicker ? <ScreenSetPicker onClose={set ? () => setPicking(false) : undefined} /> : null}
      {menu && !showPicker ? (
        <ScreenMenu
          daySet={daySet}
          video={look.video.source !== "none"}
          onChooseSet={() => {
            setMenu(false);
            setPicking(true);
          }}
          onClose={() => setMenu(false)}
        />
      ) : null}
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

/** How long OK, or a finger, is held to open the screen's menu (issue #276). */
const HOLD_MS = 800;
/** OK pressed again within this, it's one of three that open the menu (issue #285). */
const PRESS_GAP_MS = 500;
/** A remote's or a keyboard's menu keys: the menu straight away (issue #285). */
const MENU_KEYS = ["ContextMenu", "Menu", "Info"];

/** A press held still for HOLD_MS, on a touch screen or with a mouse. */
function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
  };
  useEffect(() => cancel, []);
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      cancel();
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = undefined;
        onLongPress();
      }, HOLD_MS);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
  };
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
