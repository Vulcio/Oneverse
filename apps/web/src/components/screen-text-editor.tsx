import {
  SCREEN_CHORD_NOTATIONS,
  SCREEN_DISPLAY_MODES,
  SCREEN_FOLLOW,
  SCREEN_FONT_FAMILIES,
  SCREEN_FONTS,
  SCREEN_GLOWS,
  SCREEN_LYRIC_CHORDS,
  SCREEN_OUTLINES,
  SCREEN_PACE_MS,
  SCREEN_PACES,
  SCREEN_REVEALS,
  SCREEN_SECTION_KINDS,
  SCREEN_SECTION_MARKS,
  SCREEN_SHADOWS,
  SCREEN_TRANSITION_CHOICES,
  screenTextEffects,
  type ScreenSectionKind,
  type ScreenSectionStyle,
  type ScreenTheme,
  type ScreenThemeAsset,
  type ScreenTransition,
} from "@oneverse/core";
import { AlignCenter, AlignLeft, AlignRight, CaseUpper, Check as CheckIcon, ChevronDown, Italic, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@oneverse/ui/components/input";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { cn } from "@oneverse/ui/lib/utils";
import { Choices, ColorInput, Field, Group, Slider } from "#/components/screen-editor-fields";

/*
 * A content theme's words (issue #395): how they're shown (Display), how
 * they look and change (Text and motion: the default, and a chorus's or a
 * bridge's own), and the chords over them. Typography as a design tool's
 * properties panel; effects as presets, never a free-for-all.
 */

type Text = ScreenTheme["text"];
type OnTheme = (change: (before: ScreenTheme) => Partial<ScreenTheme>) => void;

/** A pace that suits each way words appear (ms between pieces). */
const REVEAL_PACE: Record<ScreenTheme["motion"]["reveal"], number> = { none: 60, lines: 180, words: 70, letters: 25, typewriter: 18, glow: 90 };
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
/** Colours a template's words often use: white, warm white, gold, sky, rose, mint, and two darks for light backgrounds. */
const PRESET_COLORS = ["#ffffff", "#fff7e6", "#fde68a", "#7dd3fc", "#fda4af", "#86efac", "#0b1020", "#3b2470"];

/** How the words are shown, and following the music. */
export function DisplaySettings({ theme, onTheme }: { theme: ScreenTheme; onTheme: OnTheme }) {
  const { t } = useTranslation();
  const display = theme.display;
  const setDisplay = (change: Partial<ScreenTheme["display"]>) => onTheme((before) => ({ display: { ...before.display, ...change } }));
  const setScroll = (change: Partial<ScreenTheme["display"]["scroll"]>) => setDisplay({ scroll: { ...display.scroll, ...change } });
  return (
    <Group title={t("screens.editor.display")} open testId="theme-group-display">
      <Choices value={display.mode} options={SCREEN_DISPLAY_MODES} label={(one) => t(`screens.editor.displayModes.${one}`)} onChange={(mode) => setDisplay({ mode })} testId="theme-display-mode" />
      <span className="text-xs text-muted-foreground">{t(`screens.editor.displayHints.${display.mode}`)}</span>
      {display.mode === "scroll" ? (
        <div className="flex flex-col gap-3 rounded-md border border-dashed p-2.5" data-testid="theme-scroll-options">
          <Field label={t("screens.editor.scrollAnchor")}>
            <Choices value={display.scroll.anchor} options={["high", "middle", "low"] as const} label={(one) => t(`screens.editor.anchors.${one}`)} onChange={(anchor) => setScroll({ anchor })} testId="theme-scroll-anchor" />
          </Field>
          <Field label={t("screens.editor.scrollPast")}>
            <Choices value={display.scroll.past} options={["dim", "fade", "hide"] as const} label={(one) => t(`screens.editor.pasts.${one}`)} onChange={(past) => setScroll({ past })} />
          </Field>
          <Field label={t("screens.editor.scrollComing")}>
            <Choices
              value={String(display.scroll.coming)}
              options={["0", "1", "2", "3", "4"] as const}
              label={(one) => (one === "0" ? t("screens.editor.comingAll") : one)}
              onChange={(coming) => setScroll({ coming: Number(coming) })}
            />
          </Field>
          <Field label={t("screens.editor.scrollOthers")}>
            <Slider value={Math.round(display.scroll.others * 100)} min={55} max={100} step={1} unit="%" onChange={(others) => setScroll({ others: others / 100 })} />
          </Field>
          <Check label={t("screens.editor.scrollSoften")} checked={display.scroll.soften} onChange={(soften) => setScroll({ soften })} />
          <Check label={t("screens.editor.scrollLabels")} checked={display.scroll.labels} onChange={(labels) => setScroll({ labels })} testId="theme-scroll-labels" />
        </div>
      ) : null}
      {display.mode === "grid" ? <Check label={t("screens.editor.gridWords")} checked={display.grid.words} onChange={(words) => setDisplay({ grid: { words } })} /> : null}
      <Field label={t("screens.editor.follow")}>
        <Choices value={display.follow} options={SCREEN_FOLLOW} label={(one) => t(`screens.editor.follows.${one}`)} onChange={(follow) => setDisplay({ follow })} testId="theme-follow" />
      </Field>
      <span className="text-xs text-muted-foreground">{t("screens.editor.followHint")}</span>
    </Group>
  );
}

/**
 * Text and motion, with a tab for the default and one for each kind of
 * section set apart: a section's setting is the default's until it's
 * changed there, and its changes stack (a colour, bolder, italic).
 */
export function TextMotionSettings({
  theme,
  onTheme,
  fonts,
}: {
  theme: ScreenTheme;
  onTheme: OnTheme;
  /** The theme's uploaded fonts, and adding one (null until the theme is saved). */
  fonts: { assets: ScreenThemeAsset[]; uploading: boolean; onUpload: ((file: File | undefined) => void) | null };
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"default" | ScreenSectionKind>("default");
  const setText = (change: Partial<Text>) => onTheme((before) => ({ text: { ...before.text, ...change } }));
  const setMotion = (change: Partial<ScreenTheme["motion"]>) => onTheme((before) => ({ motion: { ...before.motion, ...change } }));
  const section = tab === "default" ? null : theme.sections[tab];
  const setSection = (kind: ScreenSectionKind, style: ScreenSectionStyle | null) => onTheme((before) => ({ sections: { ...before.sections, [kind]: style } }));
  const changeSection = (kind: ScreenSectionKind, change: Partial<ScreenSectionStyle>) => {
    const now = theme.sections[kind];
    if (now) setSection(kind, { ...now, ...change });
  };
  return (
    <Group title={t("screens.editor.textMotion")} open testId="theme-group-text-motion">
      <div className="flex rounded-md border p-0.5" role="tablist">
        {(["default", ...SCREEN_SECTION_KINDS] as const).map((one) => (
          <button
            key={one}
            type="button"
            role="tab"
            aria-selected={tab === one}
            onClick={() => setTab(one)}
            className={cn("h-7 flex-1 rounded px-1.5 text-xs font-medium transition-colors", tab === one ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            data-testid={`theme-text-tab-${one}`}
          >
            {t(`screens.editor.sectionTabs.${one}`)}
            {one !== "default" && theme.sections[one] ? <span className="ml-1 inline-block size-1.5 rounded-full bg-current align-middle" aria-hidden /> : null}
          </button>
        ))}
      </div>
      {tab === "default" ? (
        <>
          <TextControls value={theme.text} base={null} onChange={setText} onReset={() => undefined} fonts={fonts} />
          <MotionControls motion={theme.motion} onMotion={setMotion} />
        </>
      ) : (
        <>
          <Check label={t(`screens.editor.sectionApart.${tab}`)} checked={!!section} onChange={(on) => setSection(tab, on ? { text: {}, mark: "none", label: false, transitionInto: null, transitionWithin: null } : null)} testId="theme-section-apart" />
          {section ? (
            <>
              <span className="text-xs text-muted-foreground">{t("screens.editor.sectionHint")}</span>
              <TextControls
                value={section.text}
                base={theme.text}
                onChange={(change) => changeSection(tab, { text: { ...section.text, ...sectionText(change) } })}
                onReset={(fields) => changeSection(tab, { text: Object.fromEntries(Object.entries(section.text).filter(([key]) => !fields.includes(key as keyof SectionText))) })}
                fonts={fonts}
              />
              <Field label={t("screens.editor.mark")}>
                <Choices value={section.mark} options={SCREEN_SECTION_MARKS} label={(one) => t(`screens.editor.marks.${one}`)} onChange={(mark) => changeSection(tab, { mark })} testId="theme-section-mark" />
              </Field>
              <Check label={t("screens.editor.sectionLabel")} checked={section.label} onChange={(label) => changeSection(tab, { label })} />
              <Field label={t("screens.editor.transitionInto")}>
                <TransitionSelect value={section.transitionInto} onChange={(transitionInto) => changeSection(tab, { transitionInto })} testId="theme-section-into" />
              </Field>
              <Field label={t("screens.editor.transitionWithin")}>
                <TransitionSelect value={section.transitionWithin} onChange={(transitionWithin) => changeSection(tab, { transitionWithin })} />
              </Field>
            </>
          ) : null}
        </>
      )}
    </Group>
  );
}

/** What a section may set of a text: never the size (a song keeps one), nor the old single effect; an effect cleared is the default's again. */
function sectionText(change: Partial<Text>): Partial<ScreenSectionStyle["text"]> {
  const { shadow, outline, glow } = change;
  const rest = Object.fromEntries(Object.entries(change).filter(([key]) => !["size", "effect", "shadow", "outline", "glow"].includes(key)));
  return { ...rest, ...(shadow ? { shadow } : null), ...(outline ? { outline } : null), ...(glow ? { glow } : null) };
}

/** A section's own transition, or the default's. */
function TransitionSelect({ value, onChange, testId }: { value: ScreenTransition | null; onChange: (value: ScreenTransition | null) => void; testId?: string }) {
  const { t } = useTranslation();
  return (
    <NativeSelect value={value ?? ""} onChange={(event) => onChange((event.target.value || null) as ScreenTransition | null)} data-testid={testId}>
      <option value="">{t("screens.editor.sameAsDefault")}</option>
      {SCREEN_TRANSITION_CHOICES.map((one) => (
        <option key={one} value={one}>
          {t(`screens.editor.transitions.${one}`)}
        </option>
      ))}
    </NativeSelect>
  );
}

/** How a slide changes: the transition, its pace (or a length of one's own), and how the words come in. */
function MotionControls({ motion, onMotion }: { motion: ScreenTheme["motion"]; onMotion: (change: Partial<ScreenTheme["motion"]>) => void }) {
  const { t } = useTranslation();
  // A template using a transition no longer offered keeps it, and shows it.
  const transitions = SCREEN_TRANSITION_CHOICES.includes(motion.transition) ? SCREEN_TRANSITION_CHOICES : [...SCREEN_TRANSITION_CHOICES, motion.transition];
  return (
    <>
      <Field label={t("screens.editor.transition")}>
        <Choices value={motion.transition} options={transitions} label={(one) => t(`screens.editor.transitions.${one}`)} onChange={(transition) => onMotion({ transition })} testId="theme-transition" />
      </Field>
      {motion.transition !== "cut" ? (
        <>
          <Field label={t("screens.editor.pace")}>
            <Choices
              value={motion.pace ?? "custom"}
              options={[...SCREEN_PACES, "custom"] as const}
              label={(one) => t(`screens.editor.paces.${one}`)}
              onChange={(pace) => onMotion(pace === "custom" ? { pace: null } : { pace, duration: SCREEN_PACE_MS[pace] })}
              testId="theme-pace"
            />
          </Field>
          {motion.pace === null ? (
            <Field label={t("screens.editor.duration")}>
              <Slider value={motion.duration} min={100} max={2000} step={50} unit="ms" onChange={(duration) => onMotion({ duration })} />
            </Field>
          ) : null}
        </>
      ) : null}
      <Field label={t("screens.editor.reveal")}>
        <Choices value={motion.reveal} options={SCREEN_REVEALS} label={(one) => t(`screens.editor.reveals.${one}`)} onChange={(reveal) => onMotion({ reveal, stagger: REVEAL_PACE[reveal] })} testId="theme-reveal" />
      </Field>
      {motion.reveal !== "none" ? (
        <Field label={t("screens.editor.stagger")}>
          <Slider value={motion.stagger} min={0} max={400} step={5} unit="ms" onChange={(stagger) => onMotion({ stagger })} />
        </Field>
      ) : null}
    </>
  );
}

type SectionText = ScreenSectionStyle["text"];

/**
 * Typography, as a design tool's properties panel: the font (a list in each
 * font's own face), weight, italic and capitals, alignment, spacing, the
 * colour, and effects as presets. With a `base` (a section's tab), a field
 * not set is the base's, shown dashed, and Reset gives it back.
 */
function TextControls({
  value,
  base,
  onChange,
  onReset,
  fonts,
}: {
  value: Text | SectionText;
  base: Text | null;
  onChange: (change: Partial<Text>) => void;
  onReset: (fields: (keyof SectionText)[]) => void;
  fonts: { assets: ScreenThemeAsset[]; uploading: boolean; onUpload: ((file: File | undefined) => void) | null };
}) {
  const { t } = useTranslation();
  // What shows: the section's own, else the default's.
  const shown = { ...(base ?? {}), ...Object.fromEntries(Object.entries(value).filter(([, one]) => one !== undefined)) } as Text;
  const own = (field: keyof SectionText) => !base || (value as SectionText)[field] !== undefined;
  const effects = screenTextEffects({ effect: base?.effect ?? (value as Text).effect ?? "none", shadow: shown.shadow ?? null, outline: shown.outline ?? null, glow: shown.glow ?? null });
  // Effects are written whole once one is set, so the old single effect no longer counts.
  const setEffects = (change: Partial<typeof effects>) => {
    const next = { ...effects, ...change };
    onChange({ shadow: next.shadow, outline: next.outline, glow: next.glow });
  };
  const inherited = (field: keyof SectionText) => (base && !own(field) ? "border-dashed opacity-80" : "");
  const reset = (...fields: (keyof SectionText)[]) =>
    base && fields.some(own) ? (
      <button type="button" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => onReset(fields.filter(own))}>
        <RotateCcw className="size-3" aria-hidden />
        {t("screens.editor.reset")}
      </button>
    ) : base ? (
      <span className="text-[11px] text-muted-foreground">{t("screens.editor.inherited")}</span>
    ) : null;
  return (
    <div className="flex flex-col gap-3" data-testid={base ? "theme-section-text" : "theme-text"}>
      <Row label={t("screens.editor.font")} aside={reset("font", "customFont")}>
        <FontPicker font={shown.font} customFont={shown.customFont} className={inherited("font")} fonts={fonts} onFont={(font, customFont) => onChange({ font, customFont })} />
      </Row>
      <Row label={t("screens.editor.weight")} aside={reset("weight", "italic", "upperCase")}>
        <div className="flex items-center gap-1.5">
          <NativeSelect className={cn("h-8 min-w-0 flex-1", inherited("weight"))} value={shown.weight} onChange={(event) => onChange({ weight: Number(event.target.value) })} data-testid="theme-weight">
            {WEIGHTS.map((weight) => (
              <option key={weight} value={weight}>
                {t(`screens.editor.weights.${weight}`)}
              </option>
            ))}
          </NativeSelect>
          <IconToggle label={t("screens.editor.italic")} on={shown.italic} className={inherited("italic")} onChange={(italic) => onChange({ italic })} testId="theme-italic">
            <Italic className="size-4" aria-hidden />
          </IconToggle>
          <IconToggle label={t("screens.editor.upperCase")} on={shown.upperCase} className={inherited("upperCase")} onChange={(upperCase) => onChange({ upperCase })} testId="theme-caps">
            <CaseUpper className="size-4" aria-hidden />
          </IconToggle>
        </div>
      </Row>
      {!base ? (
        <Field label={t("screens.editor.size")}>
          <div className="flex items-center gap-2">
            <label className="flex shrink-0 items-center gap-1.5 text-xs">
              <input type="checkbox" checked={(value as Text).size === "auto"} onChange={(event) => onChange({ size: event.target.checked ? "auto" : 7 })} />
              {t("screens.editor.sizeAuto")}
            </label>
            {(value as Text).size !== "auto" ? <Slider value={(value as Text).size as number} min={2} max={20} step={0.5} onChange={(size) => onChange({ size })} /> : null}
          </div>
          <span className="text-xs text-muted-foreground">{t("screens.editor.sizeHint")}</span>
        </Field>
      ) : null}
      <Row label={t("screens.editor.align")} aside={reset("align")}>
        <div className={cn("flex w-fit rounded-md border p-0.5", inherited("align"))} role="group">
          {(["left", "center", "right"] as const).map((align) => {
            const Icon = { left: AlignLeft, center: AlignCenter, right: AlignRight }[align];
            return (
              <button
                key={align}
                type="button"
                aria-pressed={shown.align === align}
                aria-label={t(`screens.editor.aligns.${align}`)}
                title={t(`screens.editor.aligns.${align}`)}
                onClick={() => onChange({ align })}
                className={cn("grid size-7 place-items-center rounded", shown.align === align ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
              >
                <Icon className="size-4" aria-hidden />
              </button>
            );
          })}
        </div>
      </Row>
      <div className="grid grid-cols-2 gap-3">
        <Row label={t("screens.editor.letterSpacing")} aside={reset("letterSpacing")}>
          <Slider value={shown.letterSpacing} min={-0.05} max={0.3} step={0.01} onChange={(letterSpacing) => onChange({ letterSpacing })} />
        </Row>
        <Row label={t("screens.editor.lineHeight")} aside={reset("lineHeight")}>
          <Slider value={shown.lineHeight} min={0.9} max={2} step={0.05} onChange={(lineHeight) => onChange({ lineHeight })} />
        </Row>
      </div>
      <Row label={t("screens.editor.color")} aside={reset("color")}>
        <ColorField value={shown.color} className={inherited("color")} onChange={(color) => onChange({ color })} testId="theme-text-color" />
      </Row>
      <Row label={t("screens.editor.shadow")} aside={reset("shadow")}>
        <div className="flex flex-wrap items-center gap-2">
          <Choices value={effects.shadow.style} options={SCREEN_SHADOWS} label={(one) => t(`screens.editor.shadows.${one}`)} onChange={(style) => setEffects({ shadow: { ...effects.shadow, style } })} testId="theme-shadow" />
          {effects.shadow.style !== "none" ? <ColorInput value={effects.shadow.color} onChange={(color) => setEffects({ shadow: { ...effects.shadow, color } })} testId="theme-shadow-color" /> : null}
        </div>
      </Row>
      <Row label={t("screens.editor.outline")} aside={reset("outline")}>
        <div className="flex flex-wrap items-center gap-2">
          <Choices value={effects.outline.width} options={SCREEN_OUTLINES} label={(one) => t(`screens.editor.outlines.${one}`)} onChange={(width) => setEffects({ outline: { ...effects.outline, width } })} testId="theme-outline" />
          {effects.outline.width !== "none" ? <ColorInput value={effects.outline.color} onChange={(color) => setEffects({ outline: { ...effects.outline, color } })} testId="theme-outline-color" /> : null}
        </div>
      </Row>
      <Row label={t("screens.editor.glow")} aside={reset("glow")}>
        <Choices value={effects.glow} options={SCREEN_GLOWS} label={(one) => t(`screens.editor.glows.${one}`)} onChange={(glow) => setEffects({ glow })} testId="theme-glow" />
      </Row>
    </div>
  );
}

/** A field with something beside its label: Reset, or that it's the default's. */
function Row({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function IconToggle({ label, on, onChange, className, testId, children }: { label: string; on: boolean; onChange: (on: boolean) => void; className?: string; testId?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      className={cn("grid size-8 shrink-0 place-items-center rounded-md border", on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted", className)}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/** A colour: its swatch (the system picker), its hex, and a few to pick at once. */
function ColorField({ value, onChange, className, testId }: { value: string; onChange: (value: string) => void; className?: string; testId?: string }) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn("flex items-center gap-1.5 rounded-md border p-1", className)}>
        <ColorInput value={value} onChange={onChange} testId={testId} />
        <Input
          className="h-7 w-24 border-0 px-1 font-mono text-xs shadow-none"
          value={typed ?? value}
          onChange={(event) => {
            setTyped(event.target.value);
            const hex = event.target.value.trim();
            if (/^#[0-9a-f]{6}$/i.test(hex)) onChange(hex.toLowerCase());
          }}
          onBlur={() => setTyped(null)}
          aria-label="Hex"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={cn("size-5 rounded-full border", value.toLowerCase() === color && "ring-2 ring-primary ring-offset-1 ring-offset-background")}
            style={{ background: color }}
            onClick={() => onChange(color)}
            aria-label={color}
            title={color}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The font: a field showing it in its own face that opens into the list,
 * each font in its face, and the theme's uploaded fonts with Upload.
 */
function FontPicker({
  font,
  customFont,
  className,
  fonts,
  onFont,
}: {
  font: Text["font"];
  customFont: string | null | undefined;
  className?: string;
  fonts: { assets: ScreenThemeAsset[]; uploading: boolean; onUpload: ((file: File | undefined) => void) | null };
  onFont: (font: Text["font"], customFont: string | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const uploaded = fonts.assets.filter((asset) => asset.kind === "font");
  const custom = customFont ? uploaded.find((asset) => asset.id === customFont) : undefined;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn("flex h-9 items-center justify-between gap-2 rounded-md border bg-background px-2.5 text-left text-base hover:bg-muted", className)}
        style={{ fontFamily: SCREEN_FONT_FAMILIES[font] }}
        data-testid="theme-font"
      >
        <span className="truncate">{custom ? custom.filename : t(`screens.editor.fonts.${font}`)}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="flex max-h-72 flex-col overflow-y-auto rounded-md border bg-popover p-1" role="listbox" data-testid="theme-font-list">
          {SCREEN_FONTS.map((one) => (
            <button
              key={one}
              type="button"
              role="option"
              aria-selected={!custom && font === one}
              onClick={() => {
                onFont(one, null);
                setOpen(false);
              }}
              className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
              data-value={one}
            >
              <span className="text-lg leading-tight" style={{ fontFamily: SCREEN_FONT_FAMILIES[one] }}>
                {t(`screens.editor.fonts.${one}`)}
              </span>
              {!custom && font === one ? <CheckIcon className="size-4 text-primary" aria-hidden /> : null}
            </button>
          ))}
          {uploaded.length > 0 ? <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t("screens.editor.uploadedFonts")}</p> : null}
          {uploaded.map((asset) => (
            <button
              key={asset.id}
              type="button"
              role="option"
              aria-selected={custom?.id === asset.id}
              onClick={() => {
                onFont(font, asset.id);
                setOpen(false);
              }}
              className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className="truncate">{asset.filename}</span>
              {custom?.id === asset.id ? <CheckIcon className="size-4 text-primary" aria-hidden /> : null}
            </button>
          ))}
          <div className="mt-1 border-t px-2 pt-2 pb-1">
            {fonts.onUpload ? (
              <label className={cn("inline-flex h-7 cursor-pointer items-center rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-muted", fonts.uploading && "pointer-events-none opacity-60")}>
                {fonts.uploading ? t("screens.editor.uploading") : t("screens.editor.uploadFont")}
                <input
                  type="file"
                  accept=".woff2,.woff,.ttf,.otf"
                  className="sr-only"
                  data-testid="theme-upload-font"
                  onChange={(event) => {
                    fonts.onUpload?.(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
            ) : (
              <span className="text-xs text-muted-foreground">{t("screens.editor.saveFirst")}</span>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">{t("screens.editor.fontHint")}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Chords: over a lyrics template's words (off, above, on beats), how they're named, and the chart's look. */
export function ChordSettings({ theme, onTheme }: { theme: ScreenTheme; onTheme: OnTheme }) {
  const { t } = useTranslation();
  const chords = theme.chords;
  const set = (change: Partial<ScreenTheme["chords"]>) => onTheme((before) => ({ chords: { ...before.chords, ...change } }));
  const named = chords.show !== "off" || theme.display.mode === "grid" || theme.shows === "chart";
  return (
    <Group title={t("screens.editor.chords")} open={chords.show !== "off"} testId="theme-group-chords">
      {theme.shows !== "chart" ? (
        <Field label={t("screens.editor.chordsShow")}>
          <Choices value={chords.show} options={SCREEN_LYRIC_CHORDS} label={(one) => t(`screens.editor.chordShows.${one}`)} onChange={(show) => set({ show })} testId="theme-chords-show" />
        </Field>
      ) : null}
      {named ? (
        <>
          <Field label={t("screens.editor.chordNotation")}>
            <Choices value={chords.notation} options={SCREEN_CHORD_NOTATIONS} label={(one) => t(`screens.editor.chordNotations.${one}`)} onChange={(notation) => set({ notation })} />
          </Field>
          {chords.show !== "off" ? (
            <Field label={t("screens.editor.chordSize")}>
              <Slider value={Math.round(chords.size * 100)} min={35} max={90} step={1} unit="%" onChange={(size) => set({ size: size / 100 })} />
            </Field>
          ) : null}
          <Check label={t("screens.editor.chordSimple")} checked={chords.simple} onChange={(simple) => set({ simple })} />
          <Check label={t("screens.editor.chordCurrent")} checked={chords.current} onChange={(current) => set({ current })} />
        </>
      ) : null}
      <Field label={t("screens.editor.chordColor")}>
        <ColorInput value={chords.color} onChange={(color) => set({ color })} />
      </Field>
      {theme.shows === "chart" ? (
        <Field label={t("screens.editor.chordScale")}>
          <Slider value={chords.scale} min={0.5} max={2} step={0.05} onChange={(scale) => set({ scale })} />
        </Field>
      ) : null}
    </Group>
  );
}

function Check({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (checked: boolean) => void; testId?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} data-testid={testId} />
      {label}
    </label>
  );
}
