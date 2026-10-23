import { SCREEN_TEMPLATES } from "@oneverse/core";
import { Check, ChevronLeft, ListMusic, Palette, Plus, Users, Video, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { fetchScreenThemes, pairScreenAgain, pickScreenTheme, screenProfiles, showScreenProfile, type ScreenThemeOptions } from "../lib/screen-display";
import { useRemoteList } from "../lib/screen-remote";
import { VIDEO_INPUT_KEY } from "./screen-stage";
import { cn } from "@oneverse/ui/lib/utils";

const entry = "flex w-full items-center gap-[2vmin] rounded-[1.2vmin] px-[2.5vmin] py-[1.6vmin] text-left text-[3.2vmin] outline-none hover:bg-white/15 focus:bg-white focus:text-black disabled:opacity-50";

/**
 * A screen's own menu (issue #276), opened on the screen itself - OK held, a
 * double-click, a right-click or a long press - even while a set is showing:
 * another set (on a screen following the day's set; a fixed one keeps the
 * set put on it from Screens), and another theme, kept on the screen; with a
 * theme that shows a video input (issue #280), its camera or capture card,
 * kept on this device; and (issue #284) its profiles - one per pairing - to
 * show another, or pair it again for one more.
 */
export function ScreenMenu({ daySet, video = false, onChooseSet, onClose }: { daySet: boolean; video?: boolean; onChooseSet: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [view, setView] = useState<"menu" | "themes" | "videos" | "profiles">("menu");
  const [profiles] = useState(() => screenProfiles());
  const [cameras, setCameras] = useState<{ id: string; label: string }[] | null>(null);
  const [camera, setCamera] = useState<string | null>(() => readCamera());
  const [themes, setThemes] = useState<ScreenThemeOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useRemoteList(list, view !== "menu" ? () => setView("menu") : onClose);

  useEffect(() => {
    void fetchScreenThemes().then(setThemes);
  }, []);
  // Each view opens on its first entry, or the theme the screen has.
  useEffect(() => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("[data-pick]:not(:disabled)") ?? [])];
    (buttons.find((one) => one.dataset.current !== undefined) ?? buttons[0])?.focus();
  }, [view, themes, cameras]);
  // The device's cameras and capture cards, named once the browser has let the page use one.
  useEffect(() => {
    if (view !== "videos" || !navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => setCameras(devices.filter((one) => one.kind === "videoinput").map((one, i) => ({ id: one.deviceId, label: one.label || t("screens.menu.cameraN", { n: i + 1 }) }))))
      .catch(() => setCameras([]));
  }, [view, t]);
  const pickCamera = (id: string | null) => {
    try {
      if (id) localStorage.setItem(VIDEO_INPUT_KEY, id);
      else localStorage.removeItem(VIDEO_INPUT_KEY);
    } catch {
      // Storage blocked: the first camera, as before.
    }
    setCamera(id);
    window.dispatchEvent(new Event("sv-video-input"));
    onClose();
  };

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
          <p className="text-[4.5vmin] font-semibold">{view === "menu" ? t("screens.menu.title") : view === "themes" ? t("screens.menu.themesTitle") : view === "profiles" ? t("screens.menu.profilesTitle") : t("screens.menu.videoTitle")}</p>
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
              <button type="button" data-pick="profiles" onClick={() => setView("profiles")} className={entry} data-testid="screen-menu-profiles">
                <Users className="size-[3.2vmin] shrink-0 opacity-60" aria-hidden />
                <span className="min-w-0 flex-1">{t("screens.menu.profiles")}</span>
                {profiles.profiles.length > 1 ? <span className="shrink-0 text-[2.4vmin] opacity-60">{profiles.profiles[profiles.current]?.name || t("screens.menu.unnamed")}</span> : null}
              </button>
              {video ? (
                <button type="button" data-pick="videos" onClick={() => setView("videos")} className={entry} data-testid="screen-menu-videos">
                  <Video className="size-[3.2vmin] shrink-0 opacity-60" aria-hidden />
                  <span className="min-w-0 flex-1">{t("screens.menu.video")}</span>
                </button>
              ) : null}
              <button type="button" data-pick="close" onClick={onClose} className={entry} data-testid="screen-menu-close">
                <X className="size-[3.2vmin] shrink-0 opacity-60" aria-hidden />
                {t("screens.menu.close")}
              </button>
            </>
          ) : view === "profiles" ? (
            <>
              <button type="button" data-pick="back" onClick={() => setView("menu")} className={entry} data-testid="screen-menu-back">
                <ChevronLeft className="size-[3.2vmin] shrink-0 opacity-60" aria-hidden />
                {t("screens.menu.back")}
              </button>
              <p className="px-[2.5vmin] pb-[1vmin] text-[2.2vmin] opacity-60">{t("screens.menu.profilesHint")}</p>
              {profiles.profiles.map((one, i) => (
                <button
                  key={i}
                  type="button"
                  data-pick={`profile-${i}`}
                  data-current={i === profiles.current ? "" : undefined}
                  onClick={() => {
                    if (i !== profiles.current) showScreenProfile(i);
                    onClose();
                  }}
                  className={cn(entry, i === profiles.current && "ring-[0.3vmin] ring-white/50")}
                  data-testid="screen-menu-profile"
                >
                  <span className="min-w-0 flex-1 truncate">{one.name || t("screens.menu.unnamed")}</span>
                  {one.owner ? <span className="shrink-0 text-[2.2vmin] opacity-60">{one.owner}</span> : null}
                  {i === profiles.current ? <Check className="size-[3.2vmin] shrink-0" aria-label={t("screens.menu.current")} /> : null}
                </button>
              ))}
              <button
                type="button"
                data-pick="pair-again"
                onClick={() => {
                  pairScreenAgain();
                  onClose();
                }}
                className={entry}
                data-testid="screen-menu-pair-again"
              >
                <Plus className="size-[3.2vmin] shrink-0 opacity-60" aria-hidden />
                {t("screens.menu.pairAgain")}
              </button>
            </>
          ) : view === "videos" ? (
            <>
              <button type="button" data-pick="back" onClick={() => setView("menu")} className={entry} data-testid="screen-menu-back">
                <ChevronLeft className="size-[3.2vmin] shrink-0 opacity-60" aria-hidden />
                {t("screens.menu.back")}
              </button>
              <button type="button" data-pick="first" data-current={camera === null ? "" : undefined} onClick={() => pickCamera(null)} className={cn(entry, camera === null && "ring-[0.3vmin] ring-white/50")} data-testid="screen-menu-camera">
                <span className="min-w-0 flex-1 truncate">{t("screens.menu.firstCamera")}</span>
                {camera === null ? <Check className="size-[3.2vmin] shrink-0" aria-label={t("screens.menu.current")} /> : null}
              </button>
              {(cameras ?? []).map((one) => (
                <button key={one.id} type="button" data-pick={one.id} data-current={camera === one.id ? "" : undefined} onClick={() => pickCamera(one.id)} className={cn(entry, camera === one.id && "ring-[0.3vmin] ring-white/50")} data-testid="screen-menu-camera">
                  <span className="min-w-0 flex-1 truncate">{one.label}</span>
                  {camera === one.id ? <Check className="size-[3.2vmin] shrink-0" aria-label={t("screens.menu.current")} /> : null}
                </button>
              ))}
              {cameras && cameras.length === 0 ? <p className="px-[2.5vmin] text-[2.4vmin] opacity-60">{t("screens.menu.noCamera")}</p> : null}
            </>
          ) : (
            <>
              <button type="button" data-pick="back" onClick={() => setView("menu")} className={entry} data-testid="screen-menu-back">
                <ChevronLeft className="size-[3.2vmin] shrink-0 opacity-60" aria-hidden />
                {t("screens.menu.back")}
              </button>
              {heading(t("screens.menu.builtIn"))}
              {SCREEN_TEMPLATES.map((one) =>
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

function readCamera(): string | null {
  try {
    return localStorage.getItem(VIDEO_INPUT_KEY);
  } catch {
    return null;
  }
}
