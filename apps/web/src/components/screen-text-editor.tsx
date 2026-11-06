import {
  SCREEN_CHORD_NOTATIONS,
  SCREEN_DISPLAY_MODES,
  SCREEN_FOLLOW,
  SCREEN_FONT_FAMILIES,
  SCREEN_FONT_KIND,
  SCREEN_FONT_KINDS,
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
  screenShowsChart,
  screenTextEffects,
  type ScreenDisplayMode,
  type ScreenSectionKind,
  type ScreenSectionStyle,
  type ScreenTheme,
  type ScreenThemeAsset,
  type ScreenTransition,
} from "@oneverse/core";
import { AlignCenter, AlignLeft, AlignRight, CaseUpper, Check as CheckIcon, ChevronDown, Italic, MoveVertical, RotateCcw, Type } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { loadScreenFont } from "@oneverse/screen/lib/screen-fonts";
import { useTranslation } from "react-i18next";
import { Input } from "@oneverse/ui/components/input";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { cn } from "@oneverse/ui/lib/utils";
import { Choices, ColorInput, Field, Group, NumberProp, Prop, Slider, Tiles } from "#/components/screen-editor-fields";

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
  // Charts is the chord chart (issue #398): a theme from before it says so with `shows`.
  const mode: ScreenDisplayMode = screenShowsChart(theme) ? "chart" : display.mode;
  const setDisplay = (change: Partial<ScreenTheme["display"]>) => onTheme((before) => ({ display: { ...before.display, ...change } }));
  const setScroll = (change: Partial<ScreenTheme["display"]["scroll"]>) => setDisplay({ scroll: { ...display.scroll, ...change } });
  return (
    <Group title={t("screens.editor.display")} hint={t("screens.editor.groupHints.display")} open testId="theme-group-display">
      <Tiles
        value={mode}
        options={SCREEN_DISPLAY_MODES}
        columns={5}
        label={(one) => t(`screens.editor.displayModes.${one}`)}
        picture={(one) => <ModePicture mode={one} />}
        onChange={(next) => onTheme((before) => ({ display: { ...before.display, mode: next }, shows: next === "chart" ? "chart" : "lyrics" }))}
        testId="theme-display-mode"
      />
      <p className="text-xs text-muted-foreground">{t(`screens.editor.displayHints.${mode}`)}</p>
      {mode === "scroll" ? (
        <div className="flex flex-col gap-3" data-testid="theme-scroll-options">
          <Field label={t("screens.editor.scrollAnchor")}>
            <Choices value={display.scroll.anchor} options={["high", "middle", "low"] as const} label={(one) => t(`screens.editor.anchors.${one}`)} onChange={(anchor) => setScroll({ anchor })} testId="theme-scroll-anchor" />
          </Field>
          <Field label={t("screens.editor.scrollPast")}>
            <Choices value={display.scroll.past} options={["dim", "fade", "hide"] as const} label={(one) => t(`screens.editor.pasts.${one}`)} onChange={(past) => setScroll({ past })} />
          </Field>
          <Field label={t("screens.editor.scrollComing")}>
            <Choices value={String(display.scroll.coming)} options={["0", "1", "2", "3", "4"] as const} label={(one) => (one === "0" ? t("screens.editor.comingAll") : one)} onChange={(coming) => setScroll({ coming: Number(coming) })} />
          </Field>
          <Field label={t("screens.editor.scrollOthers")}>
            <Slider value={Math.round(display.scroll.others * 100)} min={55} max={100} step={1} unit="%" onChange={(others) => setScroll({ others: others / 100 })} />
          </Field>
          <Check label={t("screens.editor.scrollSoften")} checked={display.scroll.soften} onChange={(soften) => setScroll({ soften })} />
          <Check label={t("screens.editor.scrollLabels")} checked={display.scroll.labels} onChange={(labels) => setScroll({ labels })} testId="theme-scroll-labels" />
        </div>
      ) : null}
      {mode === "grid" ? <Check label={t("screens.editor.gridWords")} checked={display.grid.words} onChange={(words) => setDisplay({ grid: { words } })} /> : null}
      {mode === "chart" ? (
        <Field label={t("screens.editor.chartNext")}>
          <Choices value={String(display.chart.next) as "0"} options={["0", "1", "2", "3", "4"] as const} label={(one) => t(`screens.editor.chartNexts.${one}`)} onChange={(next) => setDisplay({ chart: { next: Number(next) } })} testId="theme-chart-next" />
        </Field>
      ) : (
        <Field label={t("screens.editor.follow")}>
          <Choices value={display.follow} options={SCREEN_FOLLOW} label={(one) => t(`screens.editor.follows.${one}`)} onChange={(follow) => setDisplay({ follow })} testId="theme-follow" />
          <span className="text-xs text-muted-foreground">{t("screens.editor.followHint")}</span>
        </Field>
      )}
    </Group>
  );
}

/** A small picture of a display mode, for its tile. */
function ModePicture({ mode }: { mode: ScreenDisplayMode }) {
  if (mode === "slides")
    return (
      <>
        <i style={{ top: "34%" }} />
        <i style={{ top: "58%", left: "30%", right: "30%" }} />
      </>
    );
  if (mode === "scroll")
    return (
      <>
        <i data-dim="" style={{ top: "8%", left: "28%", right: "28%", height: 2 }} />
        <i data-dim="" style={{ top: "28%", left: "26%", right: "26%", height: 2 }} />
        <i style={{ top: "48%", left: "18%", right: "18%" }} />
        <i data-dim="" style={{ top: "70%", left: "26%", right: "26%", height: 2 }} />
        <i data-dim="" style={{ top: "88%", left: "30%", right: "30%", height: 2 }} />
      </>
    );
  if (mode === "focus")
    return (
      <>
        <i style={{ top: "36%", left: "14%", right: "14%", height: 5 }} />
        <i data-dim="" style={{ top: "68%", left: "32%", right: "32%", height: 2 }} />
      </>
    );
  if (mode === "grid")
    return (
      <>
        {[0, 1, 2].flatMap((row) =>
          [0, 1, 2, 3].map((bar) => <b key={`${row}-${bar}`} data-on={row === 1 && bar === 1 ? "" : undefined} style={{ top: `${14 + row * 28}%`, left: `${10 + bar * 21}%`, width: "17%", height: "18%" }} />),
        )}
      </>
    );
  return (
    <>
      <b style={{ top: "8%", left: "10%", right: "10%", height: "56%" }} />
      <i data-chord="" style={{ top: "16%", left: "16%" }} />
      <i data-chord="" style={{ top: "16%", left: "52%" }} />
      <i style={{ top: "26%", left: "16%", right: "24%", height: 2 }} />
      <i data-chord="" style={{ top: "38%", left: "30%" }} />
      <i style={{ top: "48%", left: "16%", right: "30%", height: 2 }} />
      <i data-dim="" style={{ top: "76%", left: "16%", right: "28%", height: 2 }} />
      <i data-dim="" style={{ top: "90%", left: "16%", right: "40%", height: 2, opacity: 0.15 }} />
    </>
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
    <Group title={t("screens.editor.textMotion")} hint={t("screens.editor.groupHints.textMotion")} open testId="theme-group-text-motion">
      <div className="flex gap-0.5 rounded-lg border bg-muted/60 p-0.5" role="tablist">
        {(["default", ...SCREEN_SECTION_KINDS] as const).map((one) => (
          <button
            key={one}
            type="button"
            role="tab"
            aria-selected={tab === one}
            onClick={() => setTab(one)}
            className={cn("h-7 flex-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap transition-colors", tab === one ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            data-testid={`theme-text-tab-${one}`}
          >
            {t(`screens.editor.sectionTabs.${one}`)}
            {one !== "default" && theme.sections[one] ? <span className="ml-1.5 inline-block size-1.5 rounded-full bg-primary align-middle" aria-hidden /> : null}
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

/** How a slide changes (issue #398, as the #395 mockup had it): the transitions as tiles that play, a pace, and how the words come in. */
function MotionControls({ motion, onMotion }: { motion: ScreenTheme["motion"]; onMotion: (change: Partial<ScreenTheme["motion"]>) => void }) {
  const { t } = useTranslation();
  // A template using a transition no longer offered keeps it, and shows it.
  const transitions = SCREEN_TRANSITION_CHOICES.includes(motion.transition) ? SCREEN_TRANSITION_CHOICES : [...SCREEN_TRANSITION_CHOICES, motion.transition];
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <Field label={t("screens.editor.transition")}>
        <Tiles value={motion.transition} options={transitions} columns={4} label={(one) => t(`screens.editor.transitions.${one}`)} picture={(one) => <TransitionPicture transition={one} />} onChange={(transition) => onMotion({ transition })} testId="theme-transition" />
      </Field>
      {motion.transition !== "cut" ? (
        <Field label={t("screens.editor.pace")}>
          <Choices
            value={motion.pace ?? "custom"}
            options={[...SCREEN_PACES, "custom"] as const}
            label={(one) => t(`screens.editor.paces.${one}`)}
            onChange={(pace) => onMotion(pace === "custom" ? { pace: null } : { pace, duration: SCREEN_PACE_MS[pace] })}
            testId="theme-pace"
          />
          {motion.pace === null ? <Slider value={motion.duration} min={100} max={2000} step={50} unit="ms" onChange={(duration) => onMotion({ duration })} /> : null}
        </Field>
      ) : null}
      <Field label={t("screens.editor.reveal")}>
        <Choices value={motion.reveal} options={SCREEN_REVEALS} label={(one) => t(`screens.editor.reveals.${one}`)} onChange={(reveal) => onMotion({ reveal, stagger: REVEAL_PACE[reveal] })} testId="theme-reveal" />
        {motion.reveal !== "none" ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">{t("screens.editor.stagger")}</span>
            <Slider value={motion.stagger} min={0} max={400} step={5} unit="ms" onChange={(stagger) => onMotion({ stagger })} />
          </div>
        ) : null}
      </Field>
    </div>
  );
}

/** A transition's small picture: two lines coming in its way. */
function TransitionPicture({ transition }: { transition: ScreenTransition }) {
  const style = (extra: CSSProperties) => ({ "--a": `sv-t-${transition}`, ...extra }) as CSSProperties;
  return (
    <>
      <i data-anim="" style={style({ top: "34%" })} />
      <i data-anim="" style={style({ top: "58%", left: "30%", right: "30%", animationDelay: ["cascade", "relay", "drift"].includes(transition) ? "120ms" : undefined })} />
    </>
  );
}

type SectionText = ScreenSectionStyle["text"];

/**
 * Typography as a design tool's properties panel, compact (issue #398): the
 * font (a list in each font's own face); weight, italic and capitals on one
 * row; alignment and spacing on the next; the size; the colour; and the
 * effects as presets, each with its colour. With a `base` (a section's tab),
 * a setting not changed is the base's, shown dashed, and Reset gives it back.
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
  const inherited = (...fields: (keyof SectionText)[]) => (base && !fields.some(own) ? "border-dashed opacity-75" : "");
  const reset = (...fields: (keyof SectionText)[]) =>
    base && fields.some(own) ? (
      <button type="button" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline" onClick={() => onReset(fields.filter(own))}>
        <RotateCcw className="size-3" aria-hidden />
        {t("screens.editor.reset")}
      </button>
    ) : base ? (
      <span className="text-[11px] text-muted-foreground">{t("screens.editor.inherited")}</span>
    ) : null;
  const size = (value as Text).size;
  return (
    <div className="flex flex-col gap-3" data-testid={base ? "theme-section-text" : "theme-text"}>
      <Field label={t("screens.editor.font")} aside={reset("font", "customFont")}>
        <FontPicker font={shown.font} customFont={shown.customFont} className={inherited("font", "customFont")} fonts={fonts} onFont={(font, customFont) => onChange({ font, customFont })} />
      </Field>
      <Field label={t("screens.editor.textStyle")} aside={reset("weight", "italic", "upperCase")}>
        <div className="flex items-center gap-1.5">
          <NativeSelect className={cn("h-8 min-w-0 flex-1 text-xs", inherited("weight"))} value={shown.weight} onChange={(event) => onChange({ weight: Number(event.target.value) })} aria-label={t("screens.editor.weight")} data-testid="theme-weight">
            {WEIGHTS.map((weight) => (
              <option key={weight} value={weight}>
                {t(`screens.editor.weights.${weight}`)}
              </option>
            ))}
          </NativeSelect>
          <IconBar className={inherited("italic", "upperCase")}>
            <IconToggle label={t("screens.editor.italic")} on={shown.italic} onChange={(italic) => onChange({ italic })} testId="theme-italic">
              <Italic className="size-4" aria-hidden />
            </IconToggle>
            <IconToggle label={t("screens.editor.upperCase")} on={shown.upperCase} onChange={(upperCase) => onChange({ upperCase })} testId="theme-caps">
              <CaseUpper className="size-4" aria-hidden />
            </IconToggle>
          </IconBar>
        </div>
      </Field>
      <Field label={t("screens.editor.spacing")} aside={reset("align", "letterSpacing", "lineHeight")}>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
          <IconBar className={inherited("align")}>
            {(["left", "center", "right"] as const).map((align) => {
              const Icon = { left: AlignLeft, center: AlignCenter, right: AlignRight }[align];
              return (
                <IconToggle key={align} label={t(`screens.editor.aligns.${align}`)} on={shown.align === align} onChange={() => onChange({ align })}>
                  <Icon className="size-4" aria-hidden />
                </IconToggle>
              );
            })}
          </IconBar>
          <NumberProp
            icon={<span className="font-mono text-[10px]">|A|</span>}
            title={t("screens.editor.letterSpacing")}
            value={shown.letterSpacing}
            min={-0.05}
            max={0.3}
            step={0.01}
            className={inherited("letterSpacing")}
            onChange={(letterSpacing) => onChange({ letterSpacing })}
          />
          <NumberProp icon={<MoveVertical className="size-3.5" aria-hidden />} title={t("screens.editor.lineHeight")} value={shown.lineHeight} min={0.9} max={2} step={0.05} className={inherited("lineHeight")} onChange={(lineHeight) => onChange({ lineHeight })} />
        </div>
      </Field>
      {!base ? (
        <Field label={t("screens.editor.size")}>
          <div className="flex items-center gap-1.5" title={t("screens.editor.sizeHint")}>
            <Choices className="flex-1" value={size === "auto" ? "auto" : "fixed"} options={["auto", "fixed"] as const} label={(one) => t(one === "auto" ? "screens.editor.sizeAuto" : "screens.editor.sizeFixed")} onChange={(one) => onChange({ size: one === "auto" ? "auto" : 7 })} testId="theme-size" />
            {size !== "auto" ? <NumberProp icon={<Type className="size-3.5" aria-hidden />} title={t("screens.editor.size")} value={size} min={2} max={20} step={0.5} className="w-20" onChange={(next) => onChange({ size: next })} /> : null}
          </div>
        </Field>
      ) : null}
      <Field label={t("screens.editor.color")} aside={reset("color")}>
        <ColorField value={shown.color} className={inherited("color")} onChange={(color) => onChange({ color })} testId="theme-text-color" />
      </Field>
      <Field label={t("screens.editor.textEffects")} aside={reset("shadow", "outline", "glow")}>
        <div className={cn("flex flex-col gap-1.5", inherited("shadow", "outline", "glow") && "opacity-75")}>
          <EffectRow label={t("screens.editor.shadow")} color={effects.shadow.style !== "none" ? effects.shadow.color : null} onColor={(color) => setEffects({ shadow: { ...effects.shadow, color } })} colorTestId="theme-shadow-color">
            <Choices value={effects.shadow.style} options={SCREEN_SHADOWS} label={(one) => t(`screens.editor.shadows.${one}`)} onChange={(style) => setEffects({ shadow: { ...effects.shadow, style } })} testId="theme-shadow" />
          </EffectRow>
          <EffectRow label={t("screens.editor.outline")} color={effects.outline.width !== "none" ? effects.outline.color : null} onColor={(color) => setEffects({ outline: { ...effects.outline, color } })} colorTestId="theme-outline-color">
            <Choices value={effects.outline.width} options={SCREEN_OUTLINES} label={(one) => t(`screens.editor.outlines.${one}`)} onChange={(width) => setEffects({ outline: { ...effects.outline, width } })} testId="theme-outline" />
          </EffectRow>
          <EffectRow label={t("screens.editor.glow")} color={null}>
            <Choices value={effects.glow} options={SCREEN_GLOWS} label={(one) => t(`screens.editor.glows.${one}`)} onChange={(glow) => setEffects({ glow })} testId="theme-glow" />
          </EffectRow>
        </div>
      </Field>
    </div>
  );
}

/** An effect: its name, its presets, and its colour once one is on. */
function EffectRow({ label, color, onColor, colorTestId, children }: { label: string; color: string | null; onColor?: (color: string) => void; colorTestId?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[3.75rem_minmax(0,1fr)_1.25rem] items-center gap-1.5">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      {children}
      {color && onColor ? <ColorInput value={color} onChange={onColor} testId={colorTestId} /> : <span />}
    </div>
  );
}

/** Buttons joined in one bordered bar, as a design tool groups them. */
function IconBar({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex h-8 shrink-0 overflow-hidden rounded-md border bg-background [&>*+*]:border-l", className)}>{children}</div>;
}

function IconToggle({ label, on, onChange, testId, children }: { label: string; on: boolean; onChange: (on: boolean) => void; testId?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      className={cn("grid w-8 place-items-center transition-colors", on ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/** A colour: its swatch (the system picker) and hex in one field, and a few to pick at once beside it. */
function ColorField({ value, onChange, className, testId }: { value: string; onChange: (value: string) => void; className?: string; testId?: string }) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <Prop className={cn("w-32 shrink-0", className)}>
        <ColorInput value={value} onChange={onChange} testId={testId} />
        <input
          className="w-full min-w-0 bg-transparent font-mono text-xs outline-none"
          value={typed ?? value}
          onChange={(event) => {
            setTyped(event.target.value);
            const hex = event.target.value.trim();
            if (/^#[0-9a-f]{6}$/i.test(hex)) onChange(hex.toLowerCase());
          }}
          onBlur={() => setTyped(null)}
          aria-label="Hex"
        />
      </Prop>
      <div className="flex min-w-0 flex-wrap gap-1">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={cn("size-4 rounded-full border", value.toLowerCase() === color && "ring-2 ring-primary ring-offset-1 ring-offset-background")}
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
  const [kind, setKind] = useState<"all" | (typeof SCREEN_FONT_KINDS)[number]>("all");
  const [search, setSearch] = useState("");
  // Each font shown in its own face: the list's fonts loaded when it opens, the one picked at once.
  useEffect(() => {
    void loadScreenFont(font);
    if (open) SCREEN_FONTS.forEach((one) => void loadScreenFont(one));
  }, [open, font]);
  const name = (one: Text["font"]) => t(`screens.editor.fonts.${one}`);
  const listed = SCREEN_FONTS.filter((one) => (kind === "all" || SCREEN_FONT_KIND[one] === kind) && name(one).toLowerCase().includes(search.trim().toLowerCase()));
  const uploaded = fonts.assets.filter((asset) => asset.kind === "font");
  const custom = customFont ? uploaded.find((asset) => asset.id === customFont) : undefined;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn("flex h-9 items-center justify-between gap-2 rounded-md border bg-background px-2.5 text-left text-base hover:border-primary/60", className)}
        style={{ fontFamily: SCREEN_FONT_FAMILIES[font] }}
        data-testid="theme-font"
      >
        <span className="truncate">{custom ? custom.filename : t(`screens.editor.fonts.${font}`)}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="flex flex-col rounded-md border bg-popover" data-testid="theme-font-list">
          <div className="flex flex-col gap-1.5 border-b p-1.5">
            <Input className="h-7 text-xs" placeholder={t("screens.editor.fontSearch")} value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t("screens.editor.fontSearch")} data-testid="theme-font-search" />
            <div className="flex flex-wrap gap-1" role="group">
              {(["all", ...SCREEN_FONT_KINDS] as const).map((one) => (
                <button
                  key={one}
                  type="button"
                  aria-pressed={kind === one}
                  onClick={() => setKind(one)}
                  className={cn("h-6 rounded-full border px-2 text-[11px] font-medium", kind === one ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
                >
                  {t(`screens.editor.fontKinds.${one}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex max-h-72 flex-col overflow-y-auto p-1" role="listbox">
          {listed.map((one) => (
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
                {name(one)}
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
  const chart = screenShowsChart(theme);
  const named = chords.show !== "off" || theme.display.mode === "grid" || chart;
  return (
    <Group title={t("screens.editor.chords")} hint={t("screens.editor.groupHints.chords")} open={chords.show !== "off" || chart} testId="theme-group-chords">
      {!chart ? <Choices value={chords.show} options={SCREEN_LYRIC_CHORDS} label={(one) => t(`screens.editor.chordShows.${one}`)} onChange={(show) => set({ show })} testId="theme-chords-show" /> : null}
      {named ? (
        <>
          <Field label={t("screens.editor.chordNotation")}>
            <Choices value={chords.notation} options={SCREEN_CHORD_NOTATIONS} label={(one) => t(`screens.editor.chordNotations.${one}`)} onChange={(notation) => set({ notation })} />
          </Field>
          {chords.show !== "off" && !chart ? (
            <Field label={t("screens.editor.chordSize")}>
              <Slider value={Math.round(chords.size * 100)} min={35} max={90} step={1} unit="%" onChange={(size) => set({ size: size / 100 })} />
            </Field>
          ) : null}
          {chart ? (
            <Field label={t("screens.editor.chordScale")}>
              <Slider value={chords.scale} min={0.5} max={2} step={0.05} onChange={(scale) => set({ scale })} />
            </Field>
          ) : null}
          <Field label={t("screens.editor.chordColor")}>
            <ColorField value={chords.color} onChange={(color) => set({ color })} />
          </Field>
          <Field label={t("screens.editor.chordFont")}>
            <FontSelect value={chords.font} onChange={(font) => set({ font })} testId="theme-chord-font" />
          </Field>
          <Check label={t("screens.editor.chordSimple")} checked={chords.simple} onChange={(simple) => set({ simple })} />
          <Check label={t("screens.editor.chordCurrent")} checked={chords.current} onChange={(current) => set({ current })} />
        </>
      ) : null}
    </Group>
  );
}

/** A font of a part of the template (the chords, the title), or the words' own. */
export function FontSelect({ value, onChange, testId }: { value: Text["font"] | null; onChange: (font: Text["font"] | null) => void; testId?: string }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (value) void loadScreenFont(value);
  }, [value]);
  return (
    <NativeSelect className="h-8 text-sm" value={value ?? ""} onChange={(event) => onChange((event.target.value || null) as Text["font"] | null)} style={value ? { fontFamily: SCREEN_FONT_FAMILIES[value] } : undefined} data-testid={testId}>
      <option value="">{t("screens.editor.sameFont")}</option>
      {SCREEN_FONTS.map((one) => (
        <option key={one} value={one}>
          {t(`screens.editor.fonts.${one}`)}
        </option>
      ))}
    </NativeSelect>
  );
}

function Check({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (checked: boolean) => void; testId?: string }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} data-testid={testId} />
      {label}
    </label>
  );
}
