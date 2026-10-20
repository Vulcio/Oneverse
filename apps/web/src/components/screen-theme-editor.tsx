import {
  SCREEN_BACKGROUNDS,
  SCREEN_CONTEXT_STYLES,
  SCREEN_FONT_FAMILIES,
  SCREEN_FONTS,
  SCREEN_MASK_KINDS,
  SCREEN_MASK_SHAPES,
  SCREEN_MASKS_MAX,
  SCREEN_POSITIONS,
  SCREEN_REVEALS,
  SCREEN_TEXT_EFFECTS,
  SCREEN_TRANSITIONS,
  SCREEN_VIDEO_SOURCES,
  ScreenMaskSchema,
  ScreenThemeSchema,
  screenBaseColor,
  screenThemeContrast,
  type ScreenMask,
  type ScreenMode,
  type ScreenTheme,
  type ScreenThemeAsset,
  type ScreenThemeSummary,
  type ScreenWidgetDefault,
  type TeamSummary,
} from "@songverse/core";
import { ChevronLeft, ChevronRight, Pause, Play, Plus, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GridOverlay, LayoutSettings, type Grid } from "#/components/screen-layout-editor";
import { ScreenThemePreview, useSampleSong } from "#/components/screen-theme-preview";
import { Button } from "@songverse/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@songverse/ui/components/dialog";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";
import { cn } from "@songverse/ui/lib/utils";

type Part = Exclude<keyof ScreenTheme, "$schema">;

/** A pace that suits each way words appear (ms between pieces): a letter comes far sooner after the last than a line does. */
const REVEAL_PACE: Record<ScreenTheme["motion"]["reveal"], number> = { none: 60, lines: 180, words: 70, letters: 25, typewriter: 18, glow: 90 };

/** What the editor opens on: a saved theme to change, or a starting point (a built-in theme) for a new one. */
export interface ThemeDraft {
  id?: string;
  name: string;
  theme: ScreenTheme;
  ownerTeamId?: string | null;
  /** A saved theme's pictures, videos and fonts. */
  assets?: ScreenThemeAsset[];
}

/**
 * A screen theme being made or changed (issue #194): its settings on the
 * left, grouped; the screen on the right, playing a sample song, changing
 * as they're changed - at 16:9 or 4:3, on its lyrics or the band's chart.
 * Saved for the user, or for a team they're an admin of.
 */
export function ScreenThemeEditor({
  draft,
  teams,
  widgetDefaults = [],
  onClose,
  onSaved,
}: {
  draft: ThemeDraft;
  teams: TeamSummary[];
  /** Widgets' default looks (issue #273): the team's for a team's template, else the user's own. */
  widgetDefaults?: ScreenWidgetDefault[];
  onClose: () => void;
  onSaved: (theme: ScreenThemeSummary) => void;
}) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<ScreenTheme>(draft.theme);
  const [name, setName] = useState(draft.name);
  const [owner, setOwner] = useState(draft.ownerTeamId ?? "");
  const [aspect, setAspect] = useState<"16/9" | "4/3">("16/9");
  const [mode, setMode] = useState<ScreenMode>("LYRICS");
  const [playing, setPlaying] = useState(true);
  const [slide, setSlide] = useState<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [assets, setAssets] = useState<ScreenThemeAsset[]>(draft.assets ?? []);
  const [uploading, setUploading] = useState<ScreenThemeAsset["kind"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The layout (issue #268): the widget picked, and the grid drawn over the preview to move them.
  const [selected, setSelected] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const setGrid = (grid: Grid | null) => setTheme((before) => ScreenThemeSchema.parse({ ...before, grid }));
  const sample = useSampleSong(t("screens.sampleTitle"), t("screens.sampleWriters"));
  const adminTeams = teams.filter((team) => team.currentUserRole === "ADMIN");
  const contrast = screenThemeContrast(theme);

  function set<P extends Part>(part: P, change: Partial<ScreenTheme[P]>) {
    setTheme((before) => ScreenThemeSchema.parse({ ...before, [part]: { ...before[part], ...change } }));
  }

  async function save(asNew: boolean) {
    setSaving(true);
    setError(null);
    try {
      const saved =
        draft.id && !asNew
          ? await apiClient.updateScreenTheme(draft.id, { name: name.trim(), theme })
          : await apiClient.createScreenTheme({ name: name.trim(), theme, ...(owner && { teamId: owner }) });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  /** A picture, video or font for this (saved) theme: uploaded, then used at once. */
  async function upload(kind: ScreenThemeAsset["kind"], file: File | undefined) {
    if (!file || !draft.id) return;
    setUploading(kind);
    setError(null);
    try {
      const asset = await apiClient.uploadScreenThemeAsset(draft.id, kind, file, file.name);
      setAssets((before) => [...before, asset]);
      if (kind === "font") set("text", { customFont: asset.id });
      else set("background", { media: asset.id, kind: asset.mimeType.startsWith("video/") ? "video" : "image" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(null);
    }
  }

  async function removeAsset(asset: ScreenThemeAsset) {
    if (!draft.id) return;
    try {
      await apiClient.deleteScreenThemeAsset(draft.id, asset.id);
      setAssets((before) => before.filter((one) => one.id !== asset.id));
      if (theme.background.media === asset.id) set("background", { media: null });
      if (theme.text.customFont === asset.id) set("text", { customFont: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const step = (by: 1 | -1) => {
    setPlaying(false);
    setSlide((at) => ((at ?? 0) + by + sample.slides.length) % sample.slides.length);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[94dvh] w-[min(96vw,80rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" data-testid="theme-editor">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <DialogTitle className="text-base">{draft.id ? t("screens.editorEdit") : t("screens.editorNew")}</DialogTitle>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[24rem_minmax(0,1fr)] lg:overflow-hidden">
          {/* The settings, grouped; their own scroll on a wide screen. */}
          <div className="flex flex-col gap-1 border-b p-3 lg:overflow-y-auto lg:border-r lg:border-b-0">
            <Group title={t("screens.editor.layers")} testId="theme-group-layers">
              <LayersSettings theme={theme} onTheme={(change) => setTheme((before) => ScreenThemeSchema.parse({ ...before, ...change(before) }))} />
            </Group>
            <Group title={t("screens.editor.text")} open>
              <Field label={t("screens.editor.font")}>
                <NativeSelect value={theme.text.font} onChange={(e) => set("text", { font: e.target.value as ScreenTheme["text"]["font"] })} data-testid="theme-font">
                  {SCREEN_FONTS.map((font) => (
                    <option key={font} value={font} style={{ fontFamily: SCREEN_FONT_FAMILIES[font] }}>
                      {t(`screens.editor.fonts.${font}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t("screens.editor.customFont")}>
                {draft.id ? (
                  <div className="flex flex-col gap-1.5">
                    <NativeSelect value={theme.text.customFont ?? ""} onChange={(e) => set("text", { customFont: e.target.value || null })} data-testid="theme-custom-font">
                      <option value="">{t("screens.editor.customFontNone")}</option>
                      {assets
                        .filter((asset) => asset.kind === "font")
                        .map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.filename}
                          </option>
                        ))}
                    </NativeSelect>
                    <FileButton accept=".woff2,.woff,.ttf,.otf" busy={uploading === "font"} onFile={(file) => void upload("font", file)} testId="theme-upload-font" />
                    <span className="text-xs text-muted-foreground">{t("screens.editor.fontHint")}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("screens.editor.saveFirst")}</span>
                )}
              </Field>
              <Field label={t("screens.editor.size")}>
                <div className="flex items-center gap-2">
                  <label className="flex shrink-0 items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={theme.text.size === "auto"} onChange={(e) => set("text", { size: e.target.checked ? "auto" : 7 })} />
                    {t("screens.editor.sizeAuto")}
                  </label>
                  {theme.text.size !== "auto" ? <Slider value={theme.text.size} min={2} max={20} step={0.5} onChange={(size) => set("text", { size })} /> : null}
                </div>
              </Field>
              <Field label={t("screens.editor.weight")}>
                <Slider value={theme.text.weight} min={100} max={900} step={100} onChange={(weight) => set("text", { weight })} />
              </Field>
              <Field label={t("screens.editor.color")}>
                <div className="flex items-center gap-3">
                  <ColorInput value={theme.text.color} onChange={(color) => set("text", { color })} testId="theme-text-color" />
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={theme.text.upperCase} onChange={(e) => set("text", { upperCase: e.target.checked })} />
                    {t("screens.editor.upperCase")}
                  </label>
                </div>
              </Field>
              <Field label={t("screens.editor.effect")}>
                <Choices value={theme.text.effect} options={SCREEN_TEXT_EFFECTS} label={(one) => t(`screens.editor.effects.${one}`)} onChange={(effect) => set("text", { effect })} />
              </Field>
              <Field label={t("screens.editor.align")}>
                <Choices value={theme.text.align} options={["left", "center", "right"] as const} label={(one) => t(`screens.editor.aligns.${one}`)} onChange={(align) => set("text", { align })} />
              </Field>
              <Field label={t("screens.editor.lineHeight")}>
                <Slider value={theme.text.lineHeight} min={0.8} max={2.5} step={0.05} onChange={(lineHeight) => set("text", { lineHeight })} />
              </Field>
              <Field label={t("screens.editor.letterSpacing")}>
                <Slider value={theme.text.letterSpacing} min={-0.1} max={0.5} step={0.01} onChange={(letterSpacing) => set("text", { letterSpacing })} />
              </Field>
            </Group>
            <Group title={t("screens.editor.lines")}>
              <Field label={t("screens.editor.group")}>
                <Choices value={theme.lines.group} options={["slide", "section"] as const} label={(one) => t(`screens.editor.groups.${one}`)} onChange={(group) => set("lines", { group })} />
              </Field>
              {theme.lines.group === "slide" ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("screens.editor.before")}>
                    <Slider value={theme.lines.before} min={0} max={3} step={1} onChange={(before) => set("lines", { before })} />
                  </Field>
                  <Field label={t("screens.editor.after")}>
                    <Slider value={theme.lines.after} min={0} max={3} step={1} onChange={(after) => set("lines", { after })} />
                  </Field>
                </div>
              ) : null}
              <Field label={t("screens.editor.contextStyle")}>
                <Choices value={theme.lines.contextStyle} options={SCREEN_CONTEXT_STYLES} label={(one) => t(`screens.editor.contextStyles.${one}`)} onChange={(contextStyle) => set("lines", { contextStyle })} />
              </Field>
            </Group>
            <Group title={t("screens.editor.layout")}>
              <Field label={t("screens.editor.position")}>
                <Choices value={theme.layout.position} options={SCREEN_POSITIONS} label={(one) => t(`screens.editor.positions.${one}`)} onChange={(position) => set("layout", { position })} />
              </Field>
              <Field label={t("screens.editor.margin")}>
                <Slider value={theme.layout.margin} min={0} max={20} step={1} unit="%" onChange={(margin) => set("layout", { margin })} />
              </Field>
            </Group>
            <Group title={t("screens.editor.widgets")} open={!!theme.grid} testId="theme-group-widgets">
              <LayoutSettings
                grid={theme.grid}
                onGrid={setGrid}
                selected={selected}
                onSelect={setSelected}
                lookFor={(kind) => {
                  const team = draft.ownerTeamId ?? (owner || null);
                  return (widgetDefaults.find((one) => one.kind === kind && team && one.teamId === team) ?? widgetDefaults.find((one) => one.kind === kind && !one.teamId))?.look ?? null;
                }}
              />
            </Group>
            <Group title={t("screens.editor.background")} open>
              <Field label={t("screens.editor.backgroundKind")}>
                <Choices value={theme.background.kind} options={SCREEN_BACKGROUNDS} label={(one) => t(`screens.editor.backgrounds.${one}`)} onChange={(kind) => set("background", { kind })} testId="theme-background" />
              </Field>
              {theme.background.kind === "image" || theme.background.kind === "video" ? (
                <Field label={t("screens.editor.media")}>
                  {draft.id ? (
                    <div className="flex flex-col gap-1.5">
                      {assets.filter((asset) => asset.kind === "media").length === 0 ? <span className="text-xs text-muted-foreground">{t("screens.editor.noMedia")}</span> : null}
                      <ul className="flex flex-col gap-1">
                        {assets
                          .filter((asset) => asset.kind === "media")
                          .map((asset) => (
                            <li key={asset.id} className="flex items-center gap-2 text-xs" data-testid="theme-media">
                              <button
                                type="button"
                                aria-pressed={theme.background.media === asset.id}
                                onClick={() => set("background", { media: asset.id, kind: asset.mimeType.startsWith("video/") ? "video" : "image" })}
                                className={cn("min-w-0 flex-1 truncate rounded border px-2 py-1 text-left", theme.background.media === asset.id ? "border-primary bg-primary/10" : "hover:bg-muted")}
                              >
                                {asset.filename}
                              </button>
                              <button type="button" className="text-destructive hover:underline" onClick={() => void removeAsset(asset)}>
                                {t("screens.editor.removeFile")}
                              </button>
                            </li>
                          ))}
                      </ul>
                      <FileButton accept="image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/webm" busy={uploading === "media"} onFile={(file) => void upload("media", file)} testId="theme-upload-media" />
                      <span className="text-xs text-muted-foreground">{t("screens.editor.mediaHint")}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("screens.editor.saveFirst")}</span>
                  )}
                </Field>
              ) : null}
              <Field label={t("screens.editor.colors")}>
                <div className="flex flex-wrap items-center gap-2">
                  {[0, 1, 2, 3].map((i) =>
                    i === 0 || theme.background.kind !== "color" ? (
                      <ColorInput
                        key={i}
                        value={theme.background.colors[i] ?? theme.background.colors.at(-1)!}
                        onChange={(color) => {
                          const colors = [...theme.background.colors];
                          while (colors.length <= i) colors.push(colors.at(-1)!);
                          colors[i] = color;
                          set("background", { colors });
                        }}
                        testId={`theme-bg-color-${i}`}
                      />
                    ) : null,
                  )}
                </div>
              </Field>
              {theme.background.kind !== "color" && theme.background.kind !== "gradient" ? (
                <>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={theme.background.reactive} onChange={(e) => set("background", { reactive: e.target.checked })} data-testid="theme-reactive" />
                    <span>
                      {t("screens.editor.reactive")}
                      <span className="block text-xs text-muted-foreground">{t("screens.editor.reactiveHint")}</span>
                    </span>
                  </label>
                  <Field label={t("screens.editor.movement")}>
                    <Slider value={theme.background.motion} min={0} max={1} step={0.05} onChange={(motion) => set("background", { motion })} />
                  </Field>
                </>
              ) : null}
              <Field label={t("screens.editor.dim")}>
                <Slider value={theme.background.dim} min={0} max={0.9} step={0.05} onChange={(dim) => set("background", { dim })} />
              </Field>
            </Group>
            <Group title={t("screens.editor.motion")} open>
              <Field label={t("screens.editor.transition")}>
                <Choices value={theme.motion.transition} options={SCREEN_TRANSITIONS} label={(one) => t(`screens.editor.transitions.${one}`)} onChange={(transition) => set("motion", { transition })} testId="theme-transition" />
              </Field>
              {theme.motion.transition !== "cut" ? (
                <Field label={t("screens.editor.duration")}>
                  <Slider value={theme.motion.duration} min={100} max={2000} step={50} unit="ms" onChange={(duration) => set("motion", { duration })} />
                </Field>
              ) : null}
              <Field label={t("screens.editor.reveal")}>
                <Choices value={theme.motion.reveal} options={SCREEN_REVEALS} label={(one) => t(`screens.editor.reveals.${one}`)} onChange={(reveal) => set("motion", { reveal, stagger: REVEAL_PACE[reveal] })} testId="theme-reveal" />
              </Field>
              {theme.motion.reveal !== "none" ? (
                <Field label={t("screens.editor.stagger")}>
                  <Slider value={theme.motion.stagger} min={0} max={400} step={5} unit="ms" onChange={(stagger) => set("motion", { stagger })} />
                </Field>
              ) : null}
            </Group>
            <Group title={t("screens.editor.credits")}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={theme.title.show} onChange={(e) => set("title", { show: e.target.checked })} />
                {t("screens.editor.showTitle")}
              </label>
              {theme.title.show ? (
                <Field label={t("screens.editor.when")}>
                  <Choices value={theme.title.when} options={["first", "every"] as const} label={(one) => t(`screens.editor.whens.${one}`)} onChange={(when) => set("title", { when })} />
                </Field>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={theme.credits.show} onChange={(e) => set("credits", { show: e.target.checked })} />
                {t("screens.editor.showCredits")}
              </label>
              {theme.credits.show ? (
                <>
                  <Field label={t("screens.editor.when")}>
                    <NativeSelect value={theme.credits.when} onChange={(e) => set("credits", { when: e.target.value as ScreenTheme["credits"]["when"] })}>
                      {(["first", "last", "first-and-last", "every"] as const).map((when) => (
                        <option key={when} value={when}>
                          {t(`screens.editor.whens.${when}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label={t("screens.editor.where")}>
                    <Choices value={theme.credits.where} options={["bottom", "top", "lower-third"] as const} label={(one) => t(`screens.editor.wheres.${one}`)} onChange={(where) => set("credits", { where })} />
                  </Field>
                </>
              ) : null}
            </Group>
            <Group title={t("screens.editor.chords")}>
              <Field label={t("screens.editor.chordColor")}>
                <ColorInput value={theme.chords.color} onChange={(color) => set("chords", { color })} />
              </Field>
              <Field label={t("screens.editor.chordScale")}>
                <Slider value={theme.chords.scale} min={0.5} max={2} step={0.05} onChange={(scale) => set("chords", { scale })} />
              </Field>
            </Group>
          </div>

          {/* The screen, playing the sample song as the theme changes. */}
          <div className="flex min-w-0 flex-col gap-3 bg-muted/40 p-3 lg:overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{t("screens.preview")}</span>
              <Choices value={aspect} options={["16/9", "4/3"] as const} label={(one) => one.replace("/", ":")} onChange={setAspect} />
              <Choices value={mode} options={["LYRICS", "CHART"] as const} label={(one) => t(`screens.modes.${one}`)} onChange={setMode} />
              {theme.grid ? (
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" className="accent-primary" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} data-testid="theme-show-grid" />
                  {t("screens.editor.editLayout")}
                </label>
              ) : null}
              <span className="ml-auto flex items-center gap-1">
                <Button variant="outline" size="icon" className="size-8" onClick={() => step(-1)} aria-label={t("screens.previousSlidePreview")}>
                  <ChevronLeft />
                </Button>
                <Button variant="outline" size="icon" className="size-8" onClick={() => (setSlide(undefined), setPlaying(!playing))} aria-label={playing ? t("screens.previewPause") : t("screens.previewPlay")}>
                  {playing ? <Pause /> : <Play />}
                </Button>
                <Button variant="outline" size="icon" className="size-8" onClick={() => step(1)} aria-label={t("screens.nextSlidePreview")} data-testid="theme-preview-next">
                  <ChevronRight />
                </Button>
              </span>
            </div>
            <ScreenThemePreview theme={theme} assets={assets} mode={mode} aspect={aspect} playing={playing} slide={playing ? undefined : (slide ?? 0)} className={cn("w-full", aspect === "4/3" && "mx-auto max-w-[75%]")}>
              {theme.grid && showGrid ? <GridOverlay grid={theme.grid} margin={theme.layout.margin} selected={selected} onSelect={setSelected} onGrid={setGrid} /> : null}
            </ScreenThemePreview>
            <p className={cn("flex items-center gap-1.5 text-xs", contrast < 4.5 ? "text-destructive" : "text-muted-foreground")} data-testid="theme-contrast">
              {contrast < 4.5 ? <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> : null}
              {contrast < 4.5 ? t("screens.contrastLow", { ratio: contrast }) : t("screens.contrastOk", { ratio: contrast })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 border-t px-4 py-3">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <Label htmlFor="theme-name">{t("screens.themeName")}</Label>
            <Input id="theme-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </div>
          {!draft.id && adminTeams.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="theme-owner">{t("screens.themeOwner")}</Label>
              <NativeSelect id="theme-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">{t("screens.ownerMe")}</option>
                {adminTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          {error ? (
            <p className="w-full text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("screens.closeEditor")}
            </Button>
            {draft.id ? (
              <Button variant="outline" disabled={saving || !name.trim()} onClick={() => void save(true)}>
                {t("screens.saveAsNew")}
              </Button>
            ) : null}
            <Button disabled={saving || !name.trim()} onClick={() => void save(false)} data-testid="theme-save">
              {saving ? t("screens.savingTheme") : t("screens.saveTheme")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A template's layers (issue #280), besides its words, widgets and background:
 * the base colour under everything, the screen's camera or capture card, and
 * masks - black over part of the picture, or a window through the background.
 */
function LayersSettings({ theme, onTheme }: { theme: ScreenTheme; onTheme: (change: (before: ScreenTheme) => Partial<ScreenTheme>) => void }) {
  const { t } = useTranslation();
  const mask = (id: string, change: Partial<ScreenMask>) => onTheme((before) => ({ masks: before.masks.map((one) => (one.id === id ? { ...one, ...change } : one)) }));
  return (
    <>
      <p className="text-xs text-muted-foreground">{t("screens.editor.layersHint")}</p>
      <Field label={t("screens.layers.base")}>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={theme.base.color === null} onChange={(e) => onTheme((before) => ({ base: { color: e.target.checked ? null : screenBaseColor(before) } }))} data-testid="theme-base-same" />
            {t("screens.editor.baseSame")}
          </label>
          {theme.base.color ? <ColorInput value={theme.base.color} onChange={(color) => onTheme(() => ({ base: { color } }))} testId="theme-base-color" /> : null}
        </div>
      </Field>
      <Field label={t("screens.layers.video")}>
        <Choices value={theme.video.source} options={SCREEN_VIDEO_SOURCES} label={(one) => t(`screens.editor.videoSources.${one}`)} onChange={(source) => onTheme((before) => ({ video: { ...before.video, source } }))} testId="theme-video-source" />
        {theme.video.source !== "none" ? (
          <>
            <Choices value={theme.video.fit} options={["cover", "contain"] as const} label={(one) => t(`screens.editor.videoFits.${one}`)} onChange={(fit) => onTheme((before) => ({ video: { ...before.video, fit } }))} />
            <Slider value={theme.video.opacity} min={0} max={1} step={0.05} onChange={(opacity) => onTheme((before) => ({ video: { ...before.video, opacity } }))} />
            <span className="text-xs text-muted-foreground">{t("screens.editor.videoHint")}</span>
          </>
        ) : null}
      </Field>
      <Field label={t("screens.layers.masks")}>
        <ul className="flex flex-col gap-2">
          {theme.masks.map((one, i) => (
            <li key={one.id} className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2" data-testid="theme-mask">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">{t("screens.editor.maskN", { n: i + 1 })}</span>
                <button type="button" className="ml-auto text-xs text-destructive hover:underline" onClick={() => onTheme((before) => ({ masks: before.masks.filter((other) => other.id !== one.id) }))}>
                  {t("screens.editor.removeMask")}
                </button>
              </div>
              <Choices value={one.kind} options={SCREEN_MASK_KINDS} label={(kind) => t(`screens.editor.maskKinds.${kind}`)} onChange={(kind) => mask(one.id, { kind })} testId="theme-mask-kind" />
              <Choices value={one.shape} options={SCREEN_MASK_SHAPES} label={(shape) => t(`screens.editor.maskShapes.${shape}`)} onChange={(shape) => mask(one.id, { shape })} />
              {(["x", "y", "w", "h"] as const).map((side) => (
                <div key={side} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">{t(`screens.editor.maskSides.${side}`)}</span>
                  <Slider value={one[side]} min={side === "w" || side === "h" ? 1 : 0} max={100} step={1} unit="%" onChange={(value) => mask(one.id, { [side]: value })} />
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">{t("screens.editor.maskFeather")}</span>
                <Slider value={one.feather} min={0} max={10} step={0.5} onChange={(feather) => mask(one.id, { feather })} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={one.invert} onChange={(e) => mask(one.id, { invert: e.target.checked })} />
                {t("screens.editor.maskInvert")}
              </label>
            </li>
          ))}
        </ul>
        {theme.masks.length < SCREEN_MASKS_MAX ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => onTheme((before) => ({ masks: [...before.masks, ScreenMaskSchema.parse({ id: `mask-${Date.now().toString(36)}`, x: 60, y: 10, w: 30, h: 30 })] }))}
            data-testid="theme-add-mask"
          >
            <Plus />
            {t("screens.editor.addMask")}
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">{t("screens.editor.masksHint")}</span>
      </Field>
    </>
  );
}

function Group({ title, open = false, testId, children }: { title: string; open?: boolean; testId?: string; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-md border bg-card [&[open]>summary]:border-b" data-testid={testId}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold select-none">{title}</summary>
      <div className="flex flex-col gap-3 p-3">{children}</div>
    </details>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Slider({ value, min, max, step, unit = "", onChange }: { value: number; min: number; max: number; step: number; unit?: string; onChange: (value: number) => void }) {
  return (
    <div className="flex w-full items-center gap-2">
      <input type="range" className="min-w-0 flex-1 accent-primary" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {Number.isInteger(value) ? value : value.toFixed(2)}
        {unit}
      </span>
    </div>
  );
}

function ColorInput({ value, onChange, testId }: { value: string; onChange: (value: string) => void; testId?: string }) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5"
      aria-label={value}
      data-testid={testId}
    />
  );
}

/** One of a few, as buttons side by side; wraps when they don't fit. */
function Choices<T extends string>({ value, options, label, onChange, testId }: { value: T; options: readonly T[]; label: (one: T) => string; onChange: (value: T) => void; testId?: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" data-testid={testId}>
      {options.map((one) => (
        <button
          key={one}
          type="button"
          aria-pressed={value === one}
          onClick={() => onChange(one)}
          data-value={one}
          className={cn(
            "h-7 rounded-md border px-2 text-xs font-medium transition-colors",
            value === one ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {label(one)}
        </button>
      ))}
    </div>
  );
}

/** Picks a file and hands it over at once: a button, the input hidden behind it. */
function FileButton({ accept, busy, onFile, testId }: { accept: string; busy: boolean; onFile: (file: File | undefined) => void; testId?: string }) {
  const { t } = useTranslation();
  return (
    <label className={cn("inline-flex h-8 w-fit cursor-pointer items-center rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted", busy && "pointer-events-none opacity-60")}>
      {busy ? t("screens.editor.uploading") : t("screens.editor.upload")}
      <input
        type="file"
        accept={accept}
        className="sr-only"
        data-testid={testId}
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </label>
  );
}
