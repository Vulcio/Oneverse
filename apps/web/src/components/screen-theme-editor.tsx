import {
  composeScreenTheme,
  SCREEN_BACKGROUNDS,
  SCREEN_SHADERS,
  SHADER_COLORS_MAX,
  SHADER_CONTROLS,
  readIsf,
  readIsfValues,
  screenShader,
  type IsfInput,
  type IsfValue,
  SCREEN_CONTEXT_STYLES,
  SCREEN_EFFECT_TARGETS,
  SCREEN_EFFECT_TRIGGERS,
  SCREEN_EFFECTS,
  SCREEN_BACKGROUND_THEMES,
  SCREEN_CONTENT_THEMES,
  SCREEN_MASK_KINDS,
  SCREEN_MASK_SHAPES,
  SCREEN_MASKS_MAX,
  SCREEN_POSITIONS,
  SCREEN_REACTIONS_MAX,
  SCREEN_REACTION_FALL_MS,
  SCREEN_TEMPLATE_TAGS,
  SCREEN_TEMPLATES,
  SCREEN_VERSES_PER_SLIDE_MAX,
  SCREEN_TEXT_ANIMATIONS,
  SCREEN_VIDEO_SOURCES,
  ScreenMaskSchema,
  ScreenThemeSchema,
  screenBaseColor,
  screenBuiltInPart,
  screenShowsChart,
  screenThemeContrast,
  type ScreenMask,
  type ScreenPartKind,
  type ScreenPartRef,
  type ScreenPartSummary,
  type ScreenTemplateTag,
  type ScreenTheme,
  type ScreenThemeAsset,
  type ScreenThemeSummary,
  type ScreenWidgetDefault,
  type TeamSummary,
} from "@oneverse/core";
import { ChevronLeft, ChevronRight, Copy, Image as ImageIcon, LayoutGrid, Minus, Palette, Pause, Pencil, Play, Plus, Sparkles, Tag, Trash2, TriangleAlert, Type } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GridOverlay, LayoutSettings, type Grid } from "#/components/screen-layout-editor";
import { Choices, ColorInput, Field, Group, Slider } from "#/components/screen-editor-fields";
import { DisplaySettings, ChordSettings, TextMotionSettings } from "#/components/screen-text-editor";
import { ScreenThemePreview, useSampleSong } from "#/components/screen-theme-preview";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@oneverse/ui/components/dialog";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";
import { cn } from "@oneverse/ui/lib/utils";

type Part = Exclude<keyof ScreenTheme, "$schema" | "shows" | "grid" | "masks" | "effects">;

const SPEC_ORDER: string[] = Object.keys(SHADER_CONTROLS);

/** What the editor makes (issue #281): a template, or one of its parts. */
export type EditorKind = "template" | ScreenPartKind;
/** A template's parts: built-in by id, or saved. */
export type TemplateRefs = { content: ScreenPartRef; background: ScreenPartRef; effects: ScreenPartRef | null };

/**
 * What the editor opens on: a saved template or part to change, or a
 * starting point for a new one - a built-in template's parts and layout, a
 * built-in part's document.
 */
export interface ThemeDraft {
  kind: EditorKind;
  id?: string;
  name: string;
  ownerTeamId?: string | null;
  /** A template's tags, widgets and masks, and its parts. */
  tags?: ScreenTemplateTag[];
  /** How many verses of a passage it puts on a slide (issue #310). */
  versesPerSlide?: number;
  grid?: ScreenTheme["grid"];
  masks?: ScreenMask[];
  /** The title and credits are widgets in its grid (issue #398); false, a template from before: its content theme's are made widgets. */
  titleWidgets?: boolean;
  refs?: TemplateRefs;
  /** A part's document. */
  document?: unknown;
  /** A saved part's fonts, pictures and videos. */
  assets?: ScreenThemeAsset[];
}

/** A part's document by its reference: a built-in one, or a saved one among those listed. */
export function partDocument(kind: ScreenPartKind, ref: ScreenPartRef | null, parts: ScreenPartSummary[]): unknown {
  if (!ref) return null;
  return "builtIn" in ref ? screenBuiltInPart(kind as "content", ref.builtIn) : (parts.find((one) => one.id === ref.id)?.document ?? null);
}

/** What a part is previewed with (issue #281): the template it's edited from, else the classic words, a moving background, effects that show the background's reactions. */
const PREVIEW_WITH: Record<ScreenPartKind, TemplateRefs> = {
  content: { content: { builtIn: "classic" }, background: { builtIn: "classic" }, effects: null },
  background: { content: { builtIn: "classic" }, background: { builtIn: "classic" }, effects: { builtIn: "pulse" } },
  effects: { content: { builtIn: "classic" }, background: { builtIn: "concert" }, effects: null },
};

/**
 * The part a full theme holds, for saving: its words, its background, or its effects.
 * A content theme's title and credits are widgets now (issue #398): they're kept as
 * the part had them (templates from before make them widgets), off in a new one.
 */
function extractPart(kind: ScreenPartKind, theme: ScreenTheme, original?: unknown): unknown {
  if (kind === "content") {
    const before = original && typeof original === "object" ? (original as { title?: unknown; credits?: unknown }) : {};
    return { shows: theme.shows, text: theme.text, lines: theme.lines, layout: theme.layout, title: before.title ?? { show: false }, credits: before.credits ?? { show: false }, motion: theme.motion, chords: theme.chords, display: theme.display, sections: theme.sections };
  }
  if (kind === "background") return { base: theme.base, video: theme.video, background: { ...theme.background, reactive: false }, reacts: theme.reacts };
  return { reactions: theme.effects?.reactions ?? [], text: theme.effects?.text ?? {} };
}

/**
 * A template or one of its parts being made or changed (issues #194, #281):
 * its settings on the left, grouped; the screen on the right, playing a
 * sample song, changing as they're changed. A template is its tags, its
 * parts - a content theme, a background theme, effects - and its layout;
 * a part is edited on its own, previewed with the template it's edited
 * from (`context`) or with built-in ones. Saved for the user, or for a team
 * they're an admin of.
 */
export function ScreenThemeEditor({
  draft,
  teams,
  parts: listed,
  context,
  widgetDefaults = [],
  templates = [],
  onClose,
  onSaved,
}: {
  draft: ThemeDraft;
  teams: TeamSummary[];
  /** The saved parts one can use (the user's own and their teams'). */
  parts: ScreenPartSummary[];
  /** Editing a part from a template: the template's other parts, for the preview. */
  context?: TemplateRefs & { grid: ScreenTheme["grid"]; masks: ScreenMask[] };
  /** Widgets' default looks (issue #273): the team's for a team's template, else the user's own. */
  widgetDefaults?: ScreenWidgetDefault[];
  /** The saved templates, for a part's preview in one of them (issue #398). */
  templates?: ScreenThemeSummary[];
  onClose: () => void;
  onSaved: (saved: ScreenThemeSummary | ScreenPartSummary) => void;
}) {
  const { t } = useTranslation();
  const kind = draft.kind;
  // Parts saved from this editor, until the page's list has them: a background just saved previews under the words opened next.
  const [savedHere, setSavedHere] = useState<ScreenPartSummary[]>([]);
  const parts = useMemo(() => [...savedHere, ...listed.filter((one) => !savedHere.some((saved) => saved.id === one.id))], [savedHere, listed]);
  const [refs, setRefs] = useState<TemplateRefs>(draft.refs ?? { content: { builtIn: "classic" }, background: { builtIn: "classic" }, effects: null });
  const [tags, setTags] = useState<ScreenTemplateTag[]>(draft.tags ?? []);
  const [versesPerSlide, setVersesPerSlide] = useState(draft.versesPerSlide ?? 1);
  const compose = (with_: TemplateRefs, layout: { grid: ScreenTheme["grid"]; masks: ScreenMask[]; titleWidgets: boolean }, own?: unknown) =>
    composeScreenTheme({
      content: kind === "content" ? own : partDocument("content", with_.content, parts),
      background: kind === "background" ? own : partDocument("background", with_.background, parts),
      effects: kind === "effects" ? own : partDocument("effects", with_.effects, parts),
      template: layout,
    });
  const [theme, setTheme] = useState<ScreenTheme>(() =>
    kind === "template"
      ? compose(refs, { grid: draft.grid ?? null, masks: draft.masks ?? [], titleWidgets: draft.titleWidgets ?? true })
      : // A part is previewed on its own (issue #398): the template's other parts, never its widgets or masks.
        compose(context ?? PREVIEW_WITH[kind], { grid: null, masks: [], titleWidgets: true }, draft.document ?? {}),
  );
  const [name, setName] = useState(draft.name);
  const [owner, setOwner] = useState(draft.ownerTeamId ?? "");
  const [aspect, setAspect] = useState<"16/9" | "4/3">("16/9");
  const [playing, setPlaying] = useState(true);
  const [slide, setSlide] = useState<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [assets, setAssets] = useState<ScreenThemeAsset[]>(draft.assets ?? []);
  const [uploading, setUploading] = useState<ScreenThemeAsset["kind"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A part opened from the template (issue #281): changed, or customized into one of the user's own.
  const [editing, setEditing] = useState<ThemeDraft | null>(null);
  // The layout (issue #268): the widget picked, and the grid drawn over the preview to move them.
  const [selected, setSelected] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  // A template's parts, one at a time (issue #398).
  const [layer, setLayer] = useState<Layer>("content");
  const setGrid = (grid: Grid | null) => setTheme((before) => ScreenThemeSchema.parse({ ...before, grid }));
  const sample = useSampleSong(t("screens.sampleTitle"), t("screens.sampleWriters"));
  const adminTeams = teams.filter((team) => team.currentUserRole === "ADMIN");
  const contrast = screenThemeContrast(theme);
  const teamId = draft.ownerTeamId ?? (owner || null);
  // A team's template takes the team's parts; a person's, theirs and their teams'.
  const usable = parts.filter((one) => (teamId ? one.ownerTeamId === teamId : true));
  // The files the preview needs: a part's own, or those of the template's saved parts.
  const previewAssets = useMemo(() => {
    if (kind !== "template") return [...assets, ...(context ? savedAssets(context, parts) : [])];
    return savedAssets(refs, parts);
  }, [kind, assets, refs, parts, context]);
  // A part previewed on its own, or in a template (issue #398): "this" the one it's opened from, "s:<id>" a saved one, "b:<id>" a built-in one.
  const [previewIn, setPreviewIn] = useState("");
  const inTemplate = useMemo((): (TemplateRefs & { layout: { grid: ScreenTheme["grid"]; masks: ScreenMask[]; titleWidgets: boolean } }) | null => {
    if (kind === "template" || !previewIn) return null;
    if (previewIn === "this" && context) return { ...context, layout: { grid: context.grid, masks: context.masks, titleWidgets: true } };
    if (previewIn.startsWith("s:")) {
      const one = templates.find((template) => template.id === previewIn.slice(2));
      if (!one) return null;
      const ref = (view: { builtIn: string } | { id: string } | null): ScreenPartRef | null => (view ? ("builtIn" in view ? { builtIn: view.builtIn } : { id: view.id }) : null);
      return { content: ref(one.parts.content)!, background: ref(one.parts.background)!, effects: ref(one.parts.effects), layout: one.template };
    }
    const builtIn = SCREEN_TEMPLATES.find((one) => one.id === previewIn.slice(2));
    if (!builtIn) return null;
    return { content: { builtIn: builtIn.content }, background: { builtIn: builtIn.background }, effects: builtIn.effects ? { builtIn: builtIn.effects } : null, layout: builtIn.template };
  }, [kind, previewIn, context, templates]);
  // The part as it is now, with the template's other parts and its layout.
  const shown = useMemo(() => {
    if (!inTemplate) return theme;
    const own = extractPart(kind as ScreenPartKind, theme, draft.document);
    return composeScreenTheme({
      content: kind === "content" ? own : partDocument("content", inTemplate.content, parts),
      background: kind === "background" ? own : partDocument("background", inTemplate.background, parts),
      effects: kind === "effects" ? own : partDocument("effects", inTemplate.effects, parts),
      template: inTemplate.layout,
    });
  }, [inTemplate, theme, kind, parts, draft.document]);
  const shownAssets = useMemo(() => (inTemplate ? [...assets, ...savedAssets(inTemplate, parts)] : previewAssets), [inTemplate, assets, parts, previewAssets]);

  function set<P extends Part>(part: P, change: Partial<ScreenTheme[P]>) {
    setTheme((before) => ScreenThemeSchema.parse({ ...before, [part]: { ...before[part], ...change } }));
  }

  /** A template's part picked: the preview made again with it, keeping the layout. */
  function pickPart(slot: ScreenPartKind, ref: ScreenPartRef | null) {
    const next = { ...refs, [slot]: ref } as TemplateRefs;
    setRefs(next);
    setTheme((before) => compose(next, { grid: before.grid, masks: before.masks, titleWidgets: true }));
  }

  async function save(asNew: boolean) {
    setSaving(true);
    setError(null);
    try {
      let saved: ScreenThemeSummary | ScreenPartSummary;
      if (kind === "template") {
        const body = { name: name.trim(), template: { tags, grid: theme.grid, masks: theme.masks, versesPerSlide, titleWidgets: true }, content: refs.content, background: refs.background, effects: refs.effects };
        saved = draft.id && !asNew ? await apiClient.updateScreenTheme(draft.id, body) : await apiClient.createScreenTheme({ ...body, ...(teamId && { teamId }) });
      } else {
        const document = extractPart(kind, theme, draft.document) as Parameters<typeof apiClient.createScreenPart>[0]["document"];
        saved = draft.id && !asNew ? await apiClient.updateScreenPart(draft.id, { name: name.trim(), document }) : await apiClient.createScreenPart({ kind, name: name.trim(), document, ...(teamId && { teamId }) });
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  /** A font for this (saved) content theme, or a picture, video or shader for this background theme: uploaded, then used at once. */
  async function upload(assetKind: ScreenThemeAsset["kind"], file: File | undefined) {
    if (!file || !draft.id) return;
    setUploading(assetKind);
    setError(null);
    try {
      const asset = await apiClient.uploadScreenPartAsset(draft.id, assetKind, file, file.name);
      setAssets((before) => [...before, asset]);
      if (assetKind === "font") set("text", { customFont: asset.id });
      else if (assetKind === "shader") set("background", { kind: "shader", shader: { builtIn: null, asset: asset.id, values: {} } });
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
      await apiClient.deleteScreenPartAsset(draft.id, asset.id);
      setAssets((before) => before.filter((one) => one.id !== asset.id));
      if (theme.background.media === asset.id) set("background", { media: null });
      if (theme.text.customFont === asset.id) set("text", { customFont: null });
      if (theme.background.shader.asset === asset.id) set("background", { shader: { builtIn: null, asset: null, values: {} } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** A template's part opened: a saved one to change, a built-in one to customize into one of the user's own. */
  /** A widget picked on the preview: its settings, on the Widgets tab. */
  function pickWidget(id: string | null) {
    setSelected(id);
    if (id) setLayer("widgets");
  }

  /** The name of a template's part, as its row in the rail says it. */
  function partName(slot: ScreenPartKind, ref: ScreenPartRef | null): string {
    if (!ref) return t("screens.parts.noEffects");
    if ("builtIn" in ref) return t(`screens.parts.builtIn.${slot}.${ref.builtIn}`);
    return parts.find((one) => one.id === ref.id)?.name ?? "";
  }

  function openPart(slot: ScreenPartKind) {
    const ref = refs[slot];
    const saved = ref && "id" in ref ? parts.find((one) => one.id === ref.id) : undefined;
    const document = partDocument(slot, ref ?? { builtIn: "pulse" }, parts) ?? {};
    setEditing(
      saved?.canEdit
        ? { kind: slot, id: saved.id, name: saved.name, ownerTeamId: saved.ownerTeamId, document: saved.document, assets: saved.assets }
        : { kind: slot, name: t("screens.parts.copyOf", { name: saved?.name ?? (ref && "builtIn" in ref ? t(`screens.parts.builtIn.${slot}.${ref.builtIn}`) : name) }), ownerTeamId: teamId, document },
    );
  }

  const step = (by: 1 | -1) => {
    setPlaying(false);
    setSlide((at) => ((at ?? 0) + by + sample.slides.length) % sample.slides.length);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[94dvh] w-[min(96vw,80rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" data-testid={kind === "template" ? "theme-editor" : "part-editor"} data-kind={kind}>
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <DialogTitle className="text-base">{t(`screens.editor.title.${kind}.${draft.id ? "edit" : "new"}`)}</DialogTitle>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[24rem_minmax(0,1fr)] lg:overflow-hidden">
          {/* The settings, grouped; their own scroll on a wide screen. */}
          <div className="flex flex-col border-b lg:overflow-y-auto lg:border-r lg:border-b-0">
            {kind === "template" ? (
              <>
                <LayerRail
                  tab={layer}
                  onTab={setLayer}
                  names={{
                    content: partName("content", refs.content),
                    background: partName("background", refs.background),
                    effects: partName("effects", refs.effects),
                    widgets: theme.grid?.widgets.length ? t("screens.editor.widgetCount", { count: theme.grid.widgets.length }) : t("screens.editor.noWidgets"),
                    template: tags.length ? t("screens.editor.tagCount", { count: tags.length }) : "",
                  }}
                />
                {layer === "content" || layer === "background" || layer === "effects" ? (
                  <div className="flex flex-col gap-3 px-4 py-4" data-testid={`theme-layer-${layer}`}>
                    <p className="text-xs text-muted-foreground">{t(`screens.editor.partRowHints.${layer}`)}</p>
                    <PartPicker slot={layer} value={refs[layer]} parts={usable.filter((one) => one.kind === layer)} onPick={(ref) => pickPart(layer, ref)} onOpen={() => openPart(layer)} />
                  </div>
                ) : null}
                {layer === "template" ? (
                  <>
                    <p className="px-4 pt-4 text-xs text-muted-foreground">{t("screens.editor.partRowHints.template")}</p>
                    <Group title={t("screens.editor.tags")} open testId="theme-group-tags">
                      <TagPicker value={tags} onChange={setTags} testId="theme-tags" />
                      <span className="text-xs text-muted-foreground">{t("screens.editor.tagsHint")}</span>
                    </Group>
                    <Group title={t("screens.editor.passages")} open={versesPerSlide !== 1 || tags.includes("scripture")} testId="theme-group-passages">
                      <Field label={t("screens.editor.versesPerSlide")}>
                        <Input
                          type="number"
                          className="h-8 w-24"
                          min={1}
                          max={SCREEN_VERSES_PER_SLIDE_MAX}
                          value={versesPerSlide}
                          onChange={(event) => setVersesPerSlide(Math.min(SCREEN_VERSES_PER_SLIDE_MAX, Math.max(1, Math.round(Number(event.target.value) || 1))))}
                          data-testid="theme-verses-per-slide"
                        />
                      </Field>
                      <span className="text-xs text-muted-foreground">{t("screens.editor.versesPerSlideHint")}</span>
                    </Group>
                  </>
                ) : null}
                {layer === "widgets" ? (
                  <>
                    <p className="px-4 pt-4 text-xs text-muted-foreground">{t("screens.editor.partRowHints.widgets")}</p>
                    <Group title={t("screens.editor.widgets")} open testId="theme-group-widgets">
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
                    <Group title={t("screens.layers.masks")} testId="theme-group-masks">
                      <MasksSettings theme={theme} onTheme={(change) => setTheme((before) => ScreenThemeSchema.parse({ ...before, ...change(before) }))} />
                    </Group>
                  </>
                ) : null}
              </>
            ) : null}
            {kind === "content" ? (
              <>
            <DisplaySettings theme={theme} onTheme={(change) => setTheme((before) => ScreenThemeSchema.parse({ ...before, ...change(before) }))} />
            <TextMotionSettings
              theme={theme}
              onTheme={(change) => setTheme((before) => ScreenThemeSchema.parse({ ...before, ...change(before) }))}
              fonts={{ assets, uploading: uploading === "font", onUpload: draft.id ? (file) => void upload("font", file) : null }}
            />
            {/* Lines around the slide's: not for Charts, which shows the section (issue #398). */}
            {!screenShowsChart(theme) ? (
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
            ) : null}
            <Group title={t("screens.editor.layout")}>
              <Field label={t("screens.editor.position")}>
                <Choices value={theme.layout.position} options={SCREEN_POSITIONS} label={(one) => t(`screens.editor.positions.${one}`)} onChange={(position) => set("layout", { position })} />
              </Field>
              <Field label={t("screens.editor.margin")}>
                <Slider value={theme.layout.margin} min={0} max={20} step={1} unit="%" onChange={(margin) => set("layout", { margin })} />
              </Field>
            </Group>
            <ChordSettings theme={theme} onTheme={(change) => setTheme((before) => ScreenThemeSchema.parse({ ...before, ...change(before) }))} />
              </>
            ) : null}
            {kind === "background" ? (
              <>
                <Group title={t("screens.editor.baseAndVideo")} testId="theme-group-layers">
                  <BaseVideoSettings theme={theme} onTheme={(change) => setTheme((before) => ScreenThemeSchema.parse({ ...before, ...change(before) }))} />
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
              {theme.background.kind === "shader" ? (
                <ShaderSettings
                  theme={theme}
                  assets={assets}
                  saved={!!draft.id}
                  uploading={uploading === "shader"}
                  onShader={(shader) => set("background", { shader })}
                  onUpload={(file) => void upload("shader", file)}
                  onRemove={(asset) => void removeAsset(asset)}
                />
              ) : null}
              <Field label={t("screens.editor.colors")}>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Four colours, or up to eight for a shader (issue #324). */}
                  {Array.from({ length: theme.background.kind === "shader" ? Math.max(4, theme.background.colors.length) : 4 }, (_, i) => i).map((i) =>
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
                  {theme.background.kind === "shader" && theme.background.colors.length < SHADER_COLORS_MAX ? (
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      aria-label={t("screens.editor.addColor")}
                      title={t("screens.editor.addColor")}
                      onClick={() => {
                        const colors = [...theme.background.colors];
                        while (colors.length < 4) colors.push(colors.at(-1)!);
                        set("background", { colors: [...colors, colors.at(-1)!] });
                      }}
                      data-testid="theme-bg-add-color"
                    >
                      <Plus />
                    </Button>
                  ) : null}
                  {theme.background.kind === "shader" && theme.background.colors.length > 4 ? (
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      aria-label={t("screens.editor.removeColor")}
                      title={t("screens.editor.removeColor")}
                      onClick={() => set("background", { colors: theme.background.colors.slice(0, -1) })}
                      data-testid="theme-bg-remove-color"
                    >
                      <Minus />
                    </Button>
                  ) : null}
                </div>
              </Field>
              {theme.background.kind !== "color" && theme.background.kind !== "gradient" ? (
                <>
                  <Field label={t("screens.editor.movement")}>
                    <Slider value={theme.background.motion} min={0} max={1} step={0.05} onChange={(motion) => set("background", { motion })} />
                  </Field>
                  {theme.background.kind === "shader" ? (
                    <Field label={t("screens.editor.spin")}>
                      <div className="flex flex-col gap-0.5" data-testid="theme-spin">
                        <Slider value={theme.background.spin} min={-30} max={30} step={1} unit="°/s" onChange={(spin) => set("background", { spin })} />
                        <span className="text-xs text-muted-foreground">{t("screens.editor.spinHint")}</span>
                      </div>
                    </Field>
                  ) : null}
                </>
              ) : null}
              <Field label={t("screens.editor.dim")}>
                <Slider value={theme.background.dim} min={0} max={0.9} step={0.05} onChange={(dim) => set("background", { dim })} />
              </Field>
            </Group>
                <Group title={t("screens.editor.reacts")} open testId="theme-group-reacts">
                  <p className="text-xs text-muted-foreground">{t("screens.editor.reactsHint")}</p>
                  {(theme.background.kind === "shader" ? (["movement", "hue", "brightness", "elements", "rotation", "scale"] as const) : (["movement", "hue", "brightness", "elements"] as const)).map((input) => (
                    <Field key={input} label={t(`screens.editor.reactsInputs.${input}`)}>
                      <Slider value={theme.reacts[input]} min={0} max={1} step={0.05} onChange={(value) => set("reacts", { [input]: value })} />
                    </Field>
                  ))}
                </Group>
              </>
            ) : null}
            {kind === "effects" ? (
              <EffectsSettings theme={theme} onTheme={(change) => setTheme((before) => ScreenThemeSchema.parse({ ...before, ...change(before) }))} />
            ) : null}
          </div>

          {/* The screen, playing the sample song as the theme changes. */}
          <div className="flex min-w-0 flex-col gap-3 bg-muted/40 p-3 lg:overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{t("screens.preview")}</span>
              <Choices value={aspect} options={["16/9", "4/3"] as const} label={(one) => one.replace("/", ":")} onChange={setAspect} />
              {kind !== "template" ? (
                <NativeSelect className="h-8 w-auto max-w-56 text-xs" value={previewIn} onChange={(event) => setPreviewIn(event.target.value)} aria-label={t("screens.editor.previewIn")} data-testid="theme-preview-in">
                  <option value="">{t("screens.editor.previewAlone")}</option>
                  {context ? <option value="this">{t("screens.editor.previewThis")}</option> : null}
                  {templates.length > 0 ? (
                    <optgroup label={t("screens.parts.saved")}>
                      {templates.map((one) => (
                        <option key={one.id} value={`s:${one.id}`}>
                          {one.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  <optgroup label={t("screens.builtIn")}>
                    {SCREEN_TEMPLATES.map((one) => (
                      <option key={one.id} value={`b:${one.id}`}>
                        {t(`screens.templates.${one.id}.name`)}
                      </option>
                    ))}
                  </optgroup>
                </NativeSelect>
              ) : null}
              {/* The layout is the template's (issue #398): a part's editor previews it, never moves it. */}
              {theme.grid && kind === "template" ? (
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
            <ScreenThemePreview theme={shown} assets={shownAssets} aspect={aspect} playing={playing} slide={playing ? undefined : (slide ?? 0)} className={cn("w-full", aspect === "4/3" && "mx-auto max-w-[75%]")}>
              {theme.grid && showGrid && kind === "template" ? <GridOverlay grid={theme.grid} margin={theme.layout.margin} selected={selected} onSelect={pickWidget} onGrid={setGrid} /> : null}
            </ScreenThemePreview>
            <p className={cn("flex items-center gap-1.5 text-xs", contrast < 4.5 ? "text-destructive" : "text-muted-foreground")} data-testid="theme-contrast">
              {contrast < 4.5 ? <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> : null}
              {contrast < 4.5 ? t("screens.contrastLow", { ratio: contrast }) : t("screens.contrastOk", { ratio: contrast })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 border-t px-4 py-3">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <Label htmlFor="theme-name">{t(`screens.editor.nameOf.${draft.kind}`)}</Label>
            <Input id="theme-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </div>
          {!draft.id && !context && adminTeams.length > 0 ? (
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
              {saving ? t("screens.savingTheme") : t(`screens.editor.save.${draft.kind}`)}
            </Button>
          </div>
        </div>
      </DialogContent>
      {editing ? (
        <ScreenThemeEditor
          draft={editing}
          teams={teams}
          parts={parts}
          templates={templates}
          context={{ ...refs, grid: theme.grid, masks: theme.masks }}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            // The part saved, in the template at once; the list of parts comes again with the page.
            const part = saved as ScreenPartSummary;
            setSavedHere((before) => [part, ...before.filter((one) => one.id !== part.id)]);
            pickPart(part.kind, { id: part.id });
            setTheme((before) => composeScreenTheme({ ...splitParts(before), [part.kind]: part.document, template: { grid: before.grid, masks: before.masks, titleWidgets: true } }));
            onSaved(saved);
          }}
        />
      ) : null}
    </Dialog>
  );
}

/** A theme as its three parts again, for one of them to be swapped. */
function splitParts(theme: ScreenTheme) {
  return { content: extractPart("content", theme), background: extractPart("background", theme), effects: theme.effects ? extractPart("effects", theme) : null };
}

/** The files a template's saved parts refer to. */
function savedAssets(refs: TemplateRefs, parts: ScreenPartSummary[]): ScreenThemeAsset[] {
  return [refs.content, refs.background].flatMap((ref) => (ref && "id" in ref ? (parts.find((one) => one.id === ref.id)?.assets ?? []) : []));
}

type Layer = "content" | "background" | "effects" | "widgets" | "template";

const LAYER_ICONS = { content: Type, background: ImageIcon, effects: Sparkles, widgets: LayoutGrid, brand: Palette, template: Tag } as const;

/**
 * What a template is made of (issue #398), one row each: its words, its
 * background, its effects, its widgets and masks, its brand (to come, #397)
 * and its own tags; the one picked is edited under the rail.
 */
function LayerRail({ tab, onTab, names }: { tab: Layer; onTab: (tab: Layer) => void; names: Record<Layer, string> }) {
  const { t } = useTranslation();
  const rows = ["content", "background", "effects", "widgets", "brand", "template"] as const;
  return (
    <div className="flex flex-col gap-1 border-b bg-muted/30 p-3" data-testid="theme-parts">
      <span className="px-1 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t("screens.editor.madeOf")}</span>
      <div className="flex flex-col gap-0.5" role="tablist" aria-orientation="vertical">
        {rows.map((row) => {
          const Icon = LAYER_ICONS[row];
          const soon = row === "brand";
          const on = row === tab;
          return (
            <button
              key={row}
              type="button"
              role="tab"
              aria-selected={on}
              aria-disabled={soon || undefined}
              disabled={soon}
              onClick={() => (soon ? undefined : onTab(row))}
              className={cn(
                "flex h-10 items-center gap-2.5 rounded-lg px-2 text-left transition-colors",
                on ? "bg-background shadow-sm ring-1 ring-border" : soon ? "opacity-50" : "hover:bg-background/70",
              )}
              data-testid={`theme-tab-${row}`}
            >
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{t(`screens.editor.partRows.${row}`)}</span>
              <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{soon ? t("screens.editor.brandSoon") : names[row]}</span>
              {soon ? null : <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground", on ? "opacity-100" : "opacity-0")} aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A template's part (issue #281): built-in or saved, picked from a list; opened to change it (a saved one) or to customize it into one's own. */
function PartPicker({ slot, value, parts, onPick, onOpen }: { slot: ScreenPartKind; value: ScreenPartRef | null; parts: ScreenPartSummary[]; onPick: (ref: ScreenPartRef | null) => void; onOpen: () => void }) {
  const { t } = useTranslation();
  const builtIns = slot === "content" ? SCREEN_CONTENT_THEMES : slot === "background" ? SCREEN_BACKGROUND_THEMES : SCREEN_EFFECTS;
  const current = value ? ("builtIn" in value ? `b:${value.builtIn}` : `s:${value.id}`) : "";
  const saved = value && "id" in value ? parts.find((one) => one.id === value.id) : undefined;
  return (
    <Field label={t(`screens.parts.kinds.${slot}`)}>
      <div className="flex items-center gap-2">
        <NativeSelect
          className="min-w-0 flex-1"
          value={current}
          onChange={(event) => {
            const picked = event.target.value;
            onPick(picked === "" ? null : picked.startsWith("b:") ? { builtIn: picked.slice(2) } : { id: picked.slice(2) });
          }}
          data-testid={`theme-part-${slot}`}
        >
          {slot === "effects" ? <option value="">{t("screens.parts.noEffects")}</option> : null}
          {parts.length > 0 ? (
            <optgroup label={t("screens.parts.saved")}>
              {parts.map((one) => (
                <option key={one.id} value={`s:${one.id}`}>
                  {one.teamName ? `${one.name} · ${one.teamName}` : one.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label={t("screens.builtIn")}>
            {builtIns.map((one) => (
              <option key={one.id} value={`b:${one.id}`}>
                {t(`screens.parts.builtIn.${slot}.${one.id}`)}
              </option>
            ))}
          </optgroup>
        </NativeSelect>
        <Button type="button" variant="outline" size="sm" onClick={onOpen} data-testid={`theme-part-${slot}-open`}>
          {saved?.canEdit ? <Pencil /> : <Copy />}
          {saved?.canEdit ? t("screens.parts.edit") : t("screens.customize")}
        </Button>
      </div>
      {saved && saved.templates > 1 ? <span className="text-xs text-muted-foreground">{t("screens.parts.sharedBy", { count: saved.templates })}</span> : null}
    </Field>
  );
}

/** A template's tags (issue #281): what it's for, to find it. */
export function TagPicker({ value, onChange, testId }: { value: ScreenTemplateTag[]; onChange: (tags: ScreenTemplateTag[]) => void; testId?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1" role="group" data-testid={testId}>
      {SCREEN_TEMPLATE_TAGS.map((tag) => {
        const on = value.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={on}
            data-value={tag}
            onClick={() => onChange(on ? value.filter((one) => one !== tag) : [...value, tag])}
            className={cn("h-7 rounded-full border px-3 text-xs font-medium transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            {t(`screens.tags.${tag}`)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Effects (issue #281): the glue between the words and the background -
 * reactions (when a slide comes, a line or a word appears, a section
 * starts, a chorus goes on: the background pulses, moves, shifts hue,
 * brightens, its elements swell) - and an animation of the words.
 */
function EffectsSettings({ theme, onTheme }: { theme: ScreenTheme; onTheme: (change: (before: ScreenTheme) => Partial<ScreenTheme>) => void }) {
  const { t } = useTranslation();
  const effects = theme.effects ?? { reactions: [], text: { animation: "none" as const, amount: 0.5, speed: 1 } };
  const change = (next: Partial<typeof effects>) => onTheme((before) => ({ effects: { ...(before.effects ?? effects), ...next } }));
  const reaction = (i: number, next: Partial<(typeof effects.reactions)[number]>) => change({ reactions: effects.reactions.map((one, at) => (at === i ? { ...one, ...next } : one)) });
  return (
    <>
      <Group title={t("screens.editor.reactions")} open testId="theme-group-reactions">
        <p className="text-xs text-muted-foreground">{t("screens.editor.reactionsHint")}</p>
        <ul className="flex flex-col gap-2">
          {effects.reactions.map((one, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2" data-testid="theme-reaction">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-xs text-muted-foreground">{t("screens.editor.reactionWhen")}</span>
                <NativeSelect className="h-8 min-w-0 flex-1 text-xs" value={one.on} onChange={(e) => reaction(i, { on: e.target.value as typeof one.on })} data-testid="theme-reaction-on">
                  {SCREEN_EFFECT_TRIGGERS.map((on) => (
                    <option key={on} value={on}>
                      {t(`screens.editor.triggers.${on}`)}
                    </option>
                  ))}
                </NativeSelect>
                <button type="button" className="text-destructive" onClick={() => change({ reactions: effects.reactions.filter((_, at) => at !== i) })} aria-label={t("screens.editor.removeReaction")}>
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t("screens.editor.reactionThen")}</span>
                <NativeSelect className="h-8 min-w-0 flex-1 text-xs" value={one.target} onChange={(e) => reaction(i, { target: e.target.value as typeof one.target })} data-testid="theme-reaction-target">
                  {SCREEN_EFFECT_TARGETS.map((target) => (
                    <option key={target} value={target}>
                      {t(`screens.editor.targets.${target}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Slider value={one.amount} min={0} max={1} step={0.05} onChange={(amount) => reaction(i, { amount })} />
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("screens.editor.reactionRise")}>
                  <div data-testid="theme-reaction-rise">
                    <Slider value={one.rise ?? 0} min={0} max={1000} step={10} unit="ms" onChange={(rise) => reaction(i, { rise })} />
                  </div>
                </Field>
                <Field label={t("screens.editor.reactionFall")}>
                  <div data-testid="theme-reaction-fall">
                    <Slider value={one.fall ?? SCREEN_REACTION_FALL_MS} min={100} max={3000} step={50} unit="ms" onChange={(fall) => reaction(i, { fall })} />
                  </div>
                </Field>
              </div>
            </li>
          ))}
        </ul>
        {effects.reactions.length < SCREEN_REACTIONS_MAX ? (
          <Button variant="outline" size="sm" className="self-start" onClick={() => change({ reactions: [...effects.reactions, { on: "slide", target: "pulse", amount: 0.5 }] })} data-testid="theme-add-reaction">
            <Plus />
            {t("screens.editor.addReaction")}
          </Button>
        ) : null}
      </Group>
      <Group title={t("screens.editor.textAnimation")} open testId="theme-group-text-animation">
        <Choices value={effects.text.animation} options={SCREEN_TEXT_ANIMATIONS} label={(one) => t(`screens.editor.textAnimations.${one}`)} onChange={(animation) => change({ text: { ...effects.text, animation } })} testId="theme-text-animation" />
        {effects.text.animation !== "none" ? (
          <>
            <Field label={t("screens.editor.animationAmount")}>
              <Slider value={effects.text.amount} min={0} max={1} step={0.05} onChange={(amount) => change({ text: { ...effects.text, amount } })} />
            </Field>
            <Field label={t("screens.editor.animationSpeed")}>
              <Slider value={effects.text.speed} min={0.25} max={4} step={0.25} onChange={(speed) => change({ text: { ...effects.text, speed } })} />
            </Field>
          </>
        ) : null}
      </Group>
    </>
  );
}

/** A background theme's base colour and video input (issue #280). */
function BaseVideoSettings({ theme, onTheme }: { theme: ScreenTheme; onTheme: (change: (before: ScreenTheme) => Partial<ScreenTheme>) => void }) {
  const { t } = useTranslation();
  return (
    <>
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
    </>
  );
}

/** A template's masks (issue #280): black over part of the picture, or a window through the background to the video. */
function MasksSettings({ theme, onTheme }: { theme: ScreenTheme; onTheme: (change: (before: ScreenTheme) => Partial<ScreenTheme>) => void }) {
  const { t } = useTranslation();
  const mask = (id: string, change: Partial<ScreenMask>) => onTheme((before) => ({ masks: before.masks.map((one) => (one.id === id ? { ...one, ...change } : one)) }));
  return (
    <>
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

/**
 * A shader background's settings (issue #297): which shader - a built-in one,
 * or one uploaded with this background theme - and a control for each of its
 * inputs, from its ISF header (the ones the screen fills itself left out).
 */
function ShaderSettings({
  theme,
  assets,
  saved,
  uploading,
  onShader,
  onUpload,
  onRemove,
}: {
  theme: ScreenTheme;
  assets: ScreenThemeAsset[];
  saved: boolean;
  uploading: boolean;
  onShader: (shader: ScreenTheme["background"]["shader"]) => void;
  onUpload: (file: File | undefined) => void;
  onRemove: (asset: ScreenThemeAsset) => void;
}) {
  const { t } = useTranslation();
  const shader = theme.background.shader;
  const uploaded = assets.filter((asset) => asset.kind === "shader");
  const file = shader.asset ? uploaded.find((asset) => asset.id === shader.asset) : undefined;
  const [fetched, setFetched] = useState<{ url: string; source: string } | null>(null);
  useEffect(() => {
    if (!file || fetched?.url === file.url) return;
    let cancelled = false;
    fetch(file.url)
      .then((response) => (response.ok ? response.text() : ""))
      .catch(() => "")
      .then((source) => !cancelled && setFetched({ url: file.url, source }));
    return () => {
      cancelled = true;
    };
  }, [file?.url]);
  const builtIn = file ? null : (shader.builtIn ?? SCREEN_SHADERS[0]!.id);
  const source = file ? (fetched?.url === file.url ? fetched.source : null) : (screenShader(builtIn) ?? null);
  const read = useMemo(() => (source === null ? null : readIsf(source)), [source]);
  const values = read && !("error" in read) ? readIsfValues(read.inputs, shader.values) : {};
  const setValue = (name: string, value: IsfValue) => onShader({ ...shader, values: { ...shader.values, [name]: value } });
  // A standard control has the spec's name everywhere; a built-in shader's own ones are named in the locale files.
  const label = (input: IsfInput) =>
    input.standard
      ? t(`screens.editor.shaderControlNames.${input.name}`)
      : builtIn
        ? t(`screens.editor.shaderInputs.${input.name}`, { defaultValue: input.label ?? input.name })
        : (input.label ?? input.name);
  const hex = (rgba: number[]) => `#${rgba.slice(0, 3).map((one) => Math.round(one * 255).toString(16).padStart(2, "0")).join("")}`;

  return (
    <>
      <Field label={t("screens.editor.shader")}>
        <div className="flex flex-col gap-1.5" data-testid="theme-shader">
          <div className="flex flex-wrap gap-1" role="group">
            {SCREEN_SHADERS.map((one) => (
              <button
                key={one.id}
                type="button"
                aria-pressed={builtIn === one.id}
                data-value={one.id}
                onClick={() => onShader({ builtIn: one.id, asset: null, values: {} })}
                className={cn(
                  "h-7 rounded-md border px-2 text-xs font-medium transition-colors",
                  builtIn === one.id ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t(`screens.editor.shaders.${one.id}`)}
              </button>
            ))}
          </div>
          {uploaded.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {uploaded.map((asset) => (
                <li key={asset.id} className="flex items-center gap-2 text-xs" data-testid="theme-shader-file">
                  <button
                    type="button"
                    aria-pressed={shader.asset === asset.id}
                    onClick={() => onShader({ builtIn: null, asset: asset.id, values: {} })}
                    className={cn("min-w-0 flex-1 truncate rounded border px-2 py-1 text-left", shader.asset === asset.id ? "border-primary bg-primary/10" : "hover:bg-muted")}
                  >
                    {asset.filename}
                  </button>
                  <button type="button" className="text-destructive hover:underline" onClick={() => onRemove(asset)}>
                    {t("screens.editor.removeFile")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {saved ? (
            <FileButton accept=".fs,.frag,.glsl,.isf" busy={uploading} onFile={onUpload} testId="theme-upload-shader" />
          ) : (
            <span className="text-xs text-muted-foreground">{t("screens.editor.saveFirst")}</span>
          )}
          <span className="text-xs text-muted-foreground">{t("screens.editor.shaderHint")}</span>
        </div>
      </Field>
      <Field label={t("screens.editor.shaderControls")}>
        <div className="flex flex-col gap-2" data-testid="theme-shader-controls">
          {read === null ? (
            <span className="text-xs text-muted-foreground">{t("screens.editor.shaderLoading")}</span>
          ) : "error" in read ? (
            <span className="text-xs text-destructive" data-testid="theme-shader-error">
              {read.error}
            </span>
          ) : (
            <>
              {read.description && !builtIn ? <span className="text-xs text-muted-foreground">{[read.description, read.credit].filter(Boolean).join(" - ")}</span> : null}
              {read.inputs
                .filter((input) => !input.songverse && input.name in values)
                // The standard controls first, in the spec's order, then the shader's own.
                .map((input, at) => ({ input, order: input.standard ? SPEC_ORDER.indexOf(input.name) : SPEC_ORDER.length + at }))
                .sort((a, b) => a.order - b.order)
                .map(({ input }) => {
                  const value = values[input.name]!;
                  return (
                    <div key={input.name} className="flex flex-col gap-0.5" data-testid="theme-shader-input" data-name={input.name}>
                      <span className="text-xs">{input.type === "point2D" ? t("screens.editor.shaderPoint", { label: label(input) }) : label(input)}</span>
                      {input.type === "float" ? (
                        <Slider value={value as number} min={input.min ?? 0} max={input.max ?? 1} step={Math.max(0.001, ((input.max ?? 1) - (input.min ?? 0)) / 100)} onChange={(one) => setValue(input.name, one)} />
                      ) : input.type === "long" && input.values.length > 0 ? (
                        <NativeSelect value={String(value)} onChange={(event) => setValue(input.name, Number(event.target.value))}>
                          {input.values.map((one, i) => (
                            <option key={one} value={one}>
                              {input.labels[i] || one}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : input.type === "long" ? (
                        <Slider value={value as number} min={input.min ?? 0} max={input.max ?? 10} step={1} onChange={(one) => setValue(input.name, one)} />
                      ) : input.type === "bool" ? (
                        <input type="checkbox" className="size-4" checked={value as boolean} onChange={(event) => setValue(input.name, event.target.checked)} aria-label={label(input)} />
                      ) : input.type === "color" ? (
                        <ColorInput
                          value={hex(value as number[])}
                          onChange={(color) => setValue(input.name, [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).concat((value as number[])[3] ?? 1))}
                        />
                      ) : input.type === "point2D" ? (
                        <div className="flex gap-2">
                          {[0, 1].map((axis) => (
                            <Input
                              key={axis}
                              type="number"
                              step="any"
                              className="h-8"
                              value={(value as number[])[axis]}
                              onChange={(event) => {
                                const point = [...(value as number[])];
                                point[axis] = Number(event.target.value) || 0;
                                setValue(input.name, point);
                              }}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              {read.inputs.some((input) => !input.songverse && input.name in values) ? (
                <Button variant="outline" size="sm" className="w-fit" onClick={() => onShader({ ...shader, values: {} })}>
                  {t("screens.editor.shaderReset")}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">{t("screens.editor.shaderNoControls")}</span>
              )}
            </>
          )}
        </div>
      </Field>
    </>
  );
}
