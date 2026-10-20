import {
  formatTimer,
  newScreenWidget,
  placeScreenWidget,
  SCREEN_DATE_FORMATS,
  SCREEN_FONTS,
  SCREEN_QR_KINDS,
  SCREEN_GRID_MAX,
  SCREEN_LAYOUT_PRESETS,
  SCREEN_WIDGET_KINDS,
  type ScreenTheme,
  type ScreenWidget,
  type ScreenWidgetKind,
  type ScreenWidgetLook,
} from "@songverse/core";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Input } from "@songverse/ui/components/input";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { Textarea } from "@songverse/ui/components/textarea";
import { cn } from "@songverse/ui/lib/utils";

export type Grid = NonNullable<ScreenTheme["grid"]>;

/** Where a new widget goes: the first spot of its size that nothing covers, else the top left. */
function freeSpot(grid: Grid, w: number, h: number) {
  const taken = (x: number, y: number) =>
    grid.widgets.some((one) => {
      const p = placeScreenWidget(one, grid);
      return x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y;
    });
  for (let y = 0; y + h <= grid.rows; y++) for (let x = 0; x + w <= grid.columns; x++) if (!taken(x, y)) return { x, y };
  return { x: 0, y: 0 };
}

/** A new widget's size, in cells of a 12 by 12 grid (scaled to the grid it goes on). */
const SIZES: Record<ScreenWidgetKind, [number, number]> = {
  stage: [12, 12],
  "current-slide": [8, 6],
  "next-slide": [8, 3],
  "current-section": [8, 8],
  "next-section": [8, 4],
  "song-structure": [8, 2],
  clock: [4, 2],
  "analog-clock": [3, 4],
  countdown: [4, 3],
  "count-up": [4, 3],
  message: [12, 2],
  song: [4, 2],
  "next-song": [4, 2],
  "current-item": [4, 2],
  "next-item": [4, 2],
  text: [6, 2],
  date: [4, 2],
  "slide-count": [3, 2],
  "qr-code": [2, 4],
};

/**
 * A template's layout (issue #268), in the editor's settings: a ready-made
 * grid to start from, the grid's size, what Black hides, the widgets in
 * drawing order, and the picked one's options and look.
 */
export function LayoutSettings({
  grid,
  onGrid,
  selected,
  onSelect,
  lookFor,
}: {
  grid: Grid | null;
  onGrid: (grid: Grid | null) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** A kind's default look (issue #273), put on a widget as it's added. */
  lookFor?: (kind: ScreenWidgetKind) => ScreenWidgetLook | null;
}) {
  const { t } = useTranslation();
  const widget = grid?.widgets.find((one) => one.id === selected) ?? null;
  const change = (id: string, update: (widget: ScreenWidget) => ScreenWidget) => grid && onGrid({ ...grid, widgets: grid.widgets.map((one) => (one.id === id ? update(one) : one)) });

  function add(kind: ScreenWidgetKind) {
    const base: Grid = grid ?? { columns: 12, rows: 12, gap: 1, black: "all", widgets: [newScreenWidget("stage", { x: 0, y: 0, w: 12, h: 12 }, "stage")] };
    const w = Math.max(1, Math.round((SIZES[kind][0] * base.columns) / 12));
    const h = Math.max(1, Math.round((SIZES[kind][1] * base.rows) / 12));
    const id = `${kind}-${Math.random().toString(36).slice(2, 8)}`;
    onGrid({ ...base, widgets: [...base.widgets, newScreenWidget(kind, { ...freeSpot(base, w, h), w, h }, id, lookFor?.(kind) ?? {})] });
    onSelect(id);
  }

  function move(id: string, by: -1 | 1) {
    if (!grid) return;
    const at = grid.widgets.findIndex((one) => one.id === id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= grid.widgets.length) return;
    const widgets = [...grid.widgets];
    [widgets[at], widgets[to]] = [widgets[to]!, widgets[at]!];
    onGrid({ ...grid, widgets });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="theme-layout">
      <Field label={t("screens.editor.layoutPreset")}>
        <div className="flex flex-wrap gap-1" role="group">
          {SCREEN_LAYOUT_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                onGrid(preset.grid ? structuredClone(preset.grid) : null);
                onSelect(null);
              }}
              data-testid={`theme-layout-${preset.id}`}
            >
              {t(`screens.editor.layouts.${preset.id}`)}
            </Button>
          ))}
        </div>
      </Field>
      {grid ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("screens.editor.columns")}>
              <NumberInput value={grid.columns} min={1} max={SCREEN_GRID_MAX} onChange={(columns) => onGrid({ ...grid, columns })} testId="theme-grid-columns" />
            </Field>
            <Field label={t("screens.editor.rows")}>
              <NumberInput value={grid.rows} min={1} max={SCREEN_GRID_MAX} onChange={(rows) => onGrid({ ...grid, rows })} testId="theme-grid-rows" />
            </Field>
          </div>
          <Field label={t("screens.editor.gap")}>
            <input type="range" className="accent-primary" value={grid.gap} min={0} max={5} step={0.25} onChange={(e) => onGrid({ ...grid, gap: Number(e.target.value) })} />
          </Field>
          <Field label={t("screens.editor.blackHides")}>
            <NativeSelect value={grid.black} onChange={(e) => onGrid({ ...grid, black: e.target.value as Grid["black"] })} data-testid="theme-grid-black">
              <option value="all">{t("screens.editor.blackAll")}</option>
              <option value="words">{t("screens.editor.blackWords")}</option>
            </NativeSelect>
          </Field>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t("screens.editor.noGrid")}</p>
      )}
      <Field label={t("screens.editor.addWidget")}>
        <NativeSelect
          value=""
          onChange={(e) => {
            if (e.target.value) add(e.target.value as ScreenWidgetKind);
          }}
          data-testid="theme-widget-add"
        >
          <option value="">{t("screens.editor.addWidgetPick")}</option>
          {SCREEN_WIDGET_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`screens.widgetKinds.${kind}.name`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {grid && grid.widgets.length > 0 ? (
        <ul className="flex flex-col gap-1" data-testid="theme-widgets">
          {grid.widgets.map((one, i) => (
            <li key={one.id} className={cn("flex items-center gap-1 rounded-md border px-2 py-1", one.id === selected && "border-primary bg-primary/5")} data-testid={`theme-widget-row-${one.kind}`}>
              <button type="button" className="min-w-0 flex-1 truncate text-left text-xs font-medium" onClick={() => onSelect(one.id === selected ? null : one.id)} aria-pressed={one.id === selected}>
                {t(`screens.widgetKinds.${one.kind}.name`)}
                {one.kind === "text" && one.options.text ? <span className="font-normal text-muted-foreground"> · {one.options.text}</span> : null}
              </button>
              <Button type="button" size="icon" variant="ghost" className="size-6" disabled={i === grid.widgets.length - 1} onClick={() => move(one.id, 1)} aria-label={t("screens.editor.bringForward")}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="size-6" disabled={i === 0} onClick={() => move(one.id, -1)} aria-label={t("screens.editor.sendBack")}>
                <ArrowDown className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-6"
                onClick={() => {
                  onGrid({ ...grid, widgets: grid.widgets.filter((other) => other.id !== one.id) });
                  if (selected === one.id) onSelect(null);
                }}
                aria-label={t("screens.editor.removeWidget")}
                data-testid="theme-widget-remove"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {widget ? <WidgetSettings key={widget.id} widget={widget} onChange={(update) => change(widget.id, update)} /> : grid ? <p className="text-xs text-muted-foreground">{t("screens.editor.pickWidget")}</p> : null}
    </div>
  );
}

/** The picked widget's options (what it shows) and look. */
export function WidgetSettings({ widget, onChange }: { widget: ScreenWidget; onChange: (update: (widget: ScreenWidget) => ScreenWidget) => void }) {
  const { t } = useTranslation();
  const options = (change: Partial<ScreenWidget["options"]>) => onChange((one) => ({ ...one, options: { ...one.options, ...change } }));
  const style = (change: Partial<ScreenWidget["style"]>) => onChange((one) => ({ ...one, style: { ...one.style, ...change } }));
  const { kind } = widget;
  const timer = kind === "countdown" || kind === "count-up";
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3" data-testid="theme-widget-settings" data-kind={kind}>
      <p className="text-xs font-semibold">{t(`screens.widgetKinds.${kind}.name`)}</p>
      {kind === "clock" ? (
        <>
          <Field label={t("screens.editor.clockFormat")}>
            <NativeSelect value={widget.options.format} onChange={(e) => options({ format: e.target.value as "24h" | "12h" })} data-testid="theme-widget-format">
              <option value="24h">{t("screens.editor.clock24")}</option>
              <option value="12h">{t("screens.editor.clock12")}</option>
            </NativeSelect>
          </Field>
          <Check label={t("screens.editor.clockSeconds")} checked={widget.options.seconds} onChange={(seconds) => options({ seconds })} testId="theme-widget-seconds" />
          <Check label={t("screens.editor.clockDate")} checked={widget.options.date} onChange={(date) => options({ date })} />
        </>
      ) : null}
      {timer ? (
        <Field label={t("screens.editor.timerSource")}>
          <NativeSelect value={widget.options.source} onChange={(e) => options({ source: e.target.value as ScreenWidget["options"]["source"] })} data-testid="theme-widget-source">
            <option value="operator">{t("screens.editor.sources.operator")}</option>
            {kind === "countdown" ? <option value="duration">{t("screens.editor.sources.duration")}</option> : null}
            {kind === "countdown" ? <option value="until">{t("screens.editor.sources.until")}</option> : null}
            {kind === "count-up" ? <option value="song">{t("screens.editor.sources.song")}</option> : null}
          </NativeSelect>
        </Field>
      ) : null}
      {kind === "countdown" && widget.options.source === "duration" ? (
        <Field label={t("screens.editor.timerMinutes")}>
          <NumberInput value={Math.round(widget.options.duration / 60)} min={1} max={1440} onChange={(minutes) => options({ duration: minutes * 60 })} testId="theme-widget-minutes" />
        </Field>
      ) : null}
      {kind === "countdown" && widget.options.source === "until" ? (
        <Field label={t("screens.editor.timerUntil")}>
          <Input type="time" value={widget.options.until} onChange={(e) => e.target.value && options({ until: e.target.value })} data-testid="theme-widget-until" />
        </Field>
      ) : null}
      {kind === "countdown" ? (
        <>
          <Field label={t("screens.editor.timerOvertime")}>
            <NativeSelect value={widget.options.overtime} onChange={(e) => options({ overtime: e.target.value as "count" | "stop" })}>
              <option value="count">{t("screens.editor.overtimeCount")}</option>
              <option value="stop">{t("screens.editor.overtimeStop")}</option>
            </NativeSelect>
          </Field>
          <Field label={t("screens.editor.timerWarn")}>
            <NumberInput value={widget.options.warn} min={0} max={3600} onChange={(warn) => options({ warn })} />
          </Field>
        </>
      ) : null}
      {kind === "text" ? (
        <Field label={t("screens.editor.widgetText")}>
          <Textarea value={widget.options.text} maxLength={280} rows={3} onChange={(e) => options({ text: e.target.value })} data-testid="theme-widget-text" />
        </Field>
      ) : null}
      {kind === "date" ? (
        <>
          <Field label={t("screens.editor.dateFormat")}>
            <NativeSelect value={widget.options.dateFormat} onChange={(e) => options({ dateFormat: e.target.value as ScreenWidget["options"]["dateFormat"] })} data-testid="theme-widget-date-format">
              {SCREEN_DATE_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {t(`screens.editor.dateFormats.${format}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Check label={t("screens.editor.dateTime")} checked={widget.options.time} onChange={(time) => options({ time })} />
          {widget.options.time ? (
            <Field label={t("screens.editor.clockFormat")}>
              <NativeSelect value={widget.options.format} onChange={(e) => options({ format: e.target.value as "24h" | "12h" })}>
                <option value="24h">{t("screens.editor.clock24")}</option>
                <option value="12h">{t("screens.editor.clock12")}</option>
              </NativeSelect>
            </Field>
          ) : null}
        </>
      ) : null}
      {kind === "slide-count" ? (
        <>
          <Field label={t("screens.editor.slideScope")}>
            <NativeSelect value={widget.options.scope} onChange={(e) => options({ scope: e.target.value as "song" | "set" })} data-testid="theme-widget-scope">
              <option value="song">{t("screens.editor.slideScopes.song")}</option>
              <option value="set">{t("screens.editor.slideScopes.set")}</option>
            </NativeSelect>
          </Field>
          <Field label={t("screens.editor.progress")}>
            <NativeSelect value={widget.options.progress} onChange={(e) => options({ progress: e.target.value as ScreenWidget["options"]["progress"] })} data-testid="theme-widget-progress">
              <option value="none">{t("screens.editor.progresses.none")}</option>
              <option value="thin">{t("screens.editor.progresses.thin")}</option>
              <option value="thick">{t("screens.editor.progresses.thick")}</option>
            </NativeSelect>
          </Field>
        </>
      ) : null}
      {kind === "qr-code" ? <QrSettings qr={widget.options.qr} onChange={(change) => options({ qr: { ...widget.options.qr, ...change } })} /> : null}
      {kind === "song" ? <Check label={t("screens.editor.songDetails")} checked={widget.options.details} onChange={(details) => options({ details })} /> : null}
      {kind === "analog-clock" ? <Check label={t("screens.editor.secondHand")} checked={widget.options.seconds} onChange={(seconds) => options({ seconds })} testId="theme-widget-seconds" /> : null}
      {kind === "song-structure" ? <Check label={t("screens.editor.structureProgress")} checked={widget.options.details} onChange={(details) => options({ details })} /> : null}
      {kind === "current-item" ? <Check label={t("screens.editor.itemPosition")} checked={widget.options.details} onChange={(details) => options({ details })} /> : null}
      {timer ? <Breakpoints kind={kind} points={widget.options.breakpoints} onChange={(breakpoints) => options({ breakpoints })} /> : null}
      {kind !== "stage" ? (
        <Field label={t("screens.editor.widgetLabel")}>
          <Input value={widget.options.label} maxLength={60} placeholder={t("screens.editor.widgetLabelHint")} onChange={(e) => options({ label: e.target.value })} data-testid="theme-widget-label" />
        </Field>
      ) : null}

      <p className="pt-1 text-xs font-semibold text-muted-foreground">{t("screens.editor.widgetLook")}</p>
      {kind !== "stage" ? (
        <>
          <Field label={t("screens.editor.font")}>
            <NativeSelect value={widget.style.font ?? ""} onChange={(e) => style({ font: (e.target.value || null) as ScreenWidget["style"]["font"] })}>
              <option value="">{t("screens.editor.templateFont")}</option>
              {SCREEN_FONTS.map((font) => (
                <option key={font} value={font}>
                  {t(`screens.editor.fonts.${font}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("screens.editor.color")}>
            <div className="flex items-center gap-2">
              <Check label={t("screens.editor.templateColor")} checked={widget.style.color === null} onChange={(same) => style({ color: same ? null : "#ffffff" })} />
              {widget.style.color ? <input type="color" value={widget.style.color} onChange={(e) => style({ color: e.target.value })} className="h-7 w-9 rounded border bg-transparent p-0.5" aria-label={widget.style.color} /> : null}
            </div>
          </Field>
          <Field label={t("screens.editor.align")}>
            <NativeSelect value={widget.style.align} onChange={(e) => style({ align: e.target.value as ScreenWidget["style"]["align"] })}>
              <option value="left">{t("screens.editor.aligns.left")}</option>
              <option value="center">{t("screens.editor.aligns.center")}</option>
              <option value="right">{t("screens.editor.aligns.right")}</option>
            </NativeSelect>
          </Field>
          <Field label={t("screens.editor.widgetSize")}>
            <div className="flex items-center gap-2">
              <Check label={t("screens.editor.widgetSizeFit")} checked={widget.style.size === "auto"} onChange={(fit) => style({ size: fit ? "auto" : 40 })} />
              {widget.style.size !== "auto" ? (
                <input type="range" className="min-w-0 flex-1 accent-primary" value={widget.style.size} min={5} max={90} step={1} onChange={(e) => style({ size: Number(e.target.value) })} />
              ) : null}
            </div>
          </Field>
        </>
      ) : null}
      <Field label={t("screens.editor.widgetPanel")}>
        <div className="flex items-center gap-2">
          <input type="color" value={widget.style.background} onChange={(e) => style({ background: e.target.value, opacity: widget.style.opacity || 0.6 })} className="h-7 w-9 rounded border bg-transparent p-0.5" aria-label={widget.style.background} />
          <input type="range" className="min-w-0 flex-1 accent-primary" value={widget.style.opacity} min={0} max={1} step={0.05} onChange={(e) => style({ opacity: Number(e.target.value) })} data-testid="theme-widget-opacity" aria-label={t("screens.editor.widgetPanel")} />
        </div>
      </Field>
      <Field label={t("screens.editor.widgetRadius")}>
        <input type="range" className="accent-primary" value={widget.style.radius} min={0} max={10} step={0.5} onChange={(e) => style({ radius: Number(e.target.value) })} />
      </Field>
    </div>
  );
}

/** What a QR code widget holds (issue #289): an address, an event, a contact card or a Wi-Fi network, and their fields. */
function QrSettings({ qr, onChange }: { qr: ScreenWidget["options"]["qr"]; onChange: (change: Partial<ScreenWidget["options"]["qr"]>) => void }) {
  const { t } = useTranslation();
  const text = (field: "url" | "title" | "place" | "name" | "phone" | "email" | "organization" | "ssid" | "password", max: number, type = "text") => (
    <Field label={t(`screens.editor.qr.${field}`)}>
      <Input type={type} value={qr[field]} maxLength={max} onChange={(e) => onChange({ [field]: e.target.value })} data-testid={`theme-widget-qr-${field}`} />
    </Field>
  );
  return (
    <>
      <Field label={t("screens.editor.qr.kind")}>
        <NativeSelect value={qr.kind} onChange={(e) => onChange({ kind: e.target.value as ScreenWidget["options"]["qr"]["kind"] })} data-testid="theme-widget-qr-kind">
          {SCREEN_QR_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`screens.editor.qr.kinds.${kind}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {qr.kind === "url" ? text("url", 500, "url") : null}
      {qr.kind === "event" ? (
        <>
          {text("title", 120)}
          <Field label={t("screens.editor.qr.start")}>
            <Input type="datetime-local" value={qr.start} onChange={(e) => onChange({ start: e.target.value.slice(0, 16) })} data-testid="theme-widget-qr-start" />
          </Field>
          <Field label={t("screens.editor.qr.end")}>
            <Input type="datetime-local" value={qr.end} onChange={(e) => onChange({ end: e.target.value.slice(0, 16) })} />
          </Field>
          {text("place", 200)}
          {text("url", 500, "url")}
        </>
      ) : null}
      {qr.kind === "contact" ? (
        <>
          {text("name", 120)}
          {text("phone", 40, "tel")}
          {text("email", 200, "email")}
          {text("organization", 120)}
          {text("url", 500, "url")}
        </>
      ) : null}
      {qr.kind === "wifi" ? (
        <>
          {text("ssid", 64)}
          <Field label={t("screens.editor.qr.security")}>
            <NativeSelect value={qr.security} onChange={(e) => onChange({ security: e.target.value as "WPA" | "WEP" | "nopass" })}>
              <option value="WPA">WPA/WPA2/WPA3</option>
              <option value="WEP">WEP</option>
              <option value="nopass">{t("screens.editor.qr.open")}</option>
            </NativeSelect>
          </Field>
          {qr.security !== "nopass" ? text("password", 64) : null}
        </>
      ) : null}
    </>
  );
}

/**
 * A timer's colours by time (issue #272): each break point a time (m:ss) and
 * the text's and the panel's colour from then on - a countdown's once that
 * much is left, a count up's once that much has gone by.
 */
function Breakpoints({ kind, points, onChange }: { kind: ScreenWidgetKind; points: ScreenWidget["options"]["breakpoints"]; onChange: (points: ScreenWidget["options"]["breakpoints"]) => void }) {
  const { t } = useTranslation();
  const set = (i: number, change: Partial<ScreenWidget["options"]["breakpoints"][number]>) => onChange(points.map((point, j) => (j === i ? { ...point, ...change } : point)));
  return (
    <Field label={t(kind === "countdown" ? "screens.editor.breakpointsLeft" : "screens.editor.breakpointsGone")}>
      <div className="flex flex-col gap-1.5" data-testid="theme-widget-breakpoints">
        {points.length === 0 ? <p className="text-xs text-muted-foreground">{t(kind === "countdown" ? "screens.editor.breakpointsNoneDown" : "screens.editor.breakpointsNoneUp")}</p> : null}
        {points.map((point, i) => (
          <div key={i} className="flex items-center gap-1.5" data-testid="theme-widget-breakpoint">
            <Input
              defaultValue={formatTimer(point.at)}
              onBlur={(e) => {
                const at = parseTime(e.target.value);
                if (at !== null) set(i, { at });
                e.target.value = formatTimer(at ?? point.at);
              }}
              className="h-7 w-16 text-xs tabular-nums"
              aria-label={t("screens.editor.breakpointAt")}
              data-testid="theme-widget-breakpoint-at"
            />
            <OptionalColor label={t("screens.editor.breakpointText")} value={point.color} fallback="#f59e0b" onChange={(color) => set(i, { color })} testId="theme-widget-breakpoint-color" />
            <OptionalColor label={t("screens.editor.breakpointPanel")} value={point.background} fallback="#dc2626" onChange={(background) => set(i, { background })} testId="theme-widget-breakpoint-background" />
            <Button type="button" size="icon" variant="ghost" className="ml-auto size-6" onClick={() => onChange(points.filter((_, j) => j !== i))} aria-label={t("screens.editor.removeWidget")}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        {points.length < 6 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 w-fit text-xs"
            onClick={() => onChange([...points, { at: kind === "countdown" ? (points.length === 0 ? 300 : 60) : 600, color: "#f59e0b", background: null }])}
            data-testid="theme-widget-breakpoint-add"
          >
            <Plus className="size-3.5" />
            {t("screens.editor.breakpointAdd")}
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

/** A colour that can be left as it is (null): ticked, its swatch. */
function OptionalColor({ label, value, fallback, onChange, testId }: { label: string; value: string | null; fallback: string; onChange: (value: string | null) => void; testId?: string }) {
  return (
    <label className="flex items-center gap-1 text-xs" title={label}>
      <input type="checkbox" className="accent-primary" checked={value !== null} onChange={(e) => onChange(e.target.checked ? fallback : null)} aria-label={label} data-testid={testId} />
      {value !== null ? <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-7 rounded border bg-transparent p-0.5" aria-label={label} /> : <span className="text-muted-foreground">{label}</span>}
    </label>
  );
}

/** "5:00", "90" or "1:02:03" as seconds; null when it isn't a time. */
function parseTime(text: string): number | null {
  const parts = text.trim().split(":").map((one) => Number(one));
  if (parts.length === 0 || parts.length > 3 || parts.some((one) => !Number.isFinite(one) || one < 0)) return null;
  const seconds = parts.reduce((sum, one) => sum * 60 + one, 0);
  return Number.isInteger(seconds) && seconds <= 86_400 ? seconds : null;
}

/**
 * The grid over the editor's preview (issue #268): the cells, and each widget
 * as a box to pick, drag to another place, or resize from its corner - or,
 * picked, with the arrow keys (Shift resizes). Matches the screen's grid: the
 * same safe margin, gap and cells.
 */
export function GridOverlay({ grid, margin, selected, onSelect, onGrid }: { grid: Grid; margin: number; selected: string | null; onSelect: (id: string | null) => void; onGrid: (grid: Grid) => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; resize: boolean; x: number; y: number; start: { x: number; y: number; w: number; h: number } } | null>(null);

  /** One cell's width and height on screen, gap included. */
  const pitch = () => {
    const element = ref.current;
    if (!element) return { x: 1, y: 1 };
    const rect = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    const inner = (size: number, a: string, b: string) => size - parseFloat(a) - parseFloat(b);
    const gapX = parseFloat(css.columnGap) || 0;
    const gapY = parseFloat(css.rowGap) || 0;
    return {
      x: (inner(rect.width, css.paddingLeft, css.paddingRight) + gapX) / grid.columns,
      y: (inner(rect.height, css.paddingTop, css.paddingBottom) + gapY) / grid.rows,
    };
  };

  const place = (id: string, next: { x: number; y: number; w: number; h: number }) => {
    const fitted = placeScreenWidget(
      { x: Math.max(0, next.x), y: Math.max(0, next.y), w: Math.max(1, next.w), h: Math.max(1, next.h) },
      grid,
    );
    onGrid({ ...grid, widgets: grid.widgets.map((one) => (one.id === id ? { ...one, ...fitted } : one)) });
  };

  const start = (event: ReactPointerEvent, widget: ScreenWidget, resize: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(widget.id);
    (event.target as Element).setPointerCapture?.(event.pointerId);
    drag.current = { id: widget.id, resize, x: event.clientX, y: event.clientY, start: placeScreenWidget(widget, grid) };
  };
  const moveTo = (event: ReactPointerEvent) => {
    const now = drag.current;
    if (!now) return;
    const cell = pitch();
    const dx = Math.round((event.clientX - now.x) / cell.x);
    const dy = Math.round((event.clientY - now.y) / cell.y);
    const { start: was } = now;
    if (now.resize) place(now.id, { ...was, w: was.w + dx, h: was.h + dy });
    else place(now.id, { ...was, x: Math.min(grid.columns - was.w, Math.max(0, was.x + dx)), y: Math.min(grid.rows - was.h, Math.max(0, was.y + dy)) });
  };
  const end = () => (drag.current = null);

  const keys = (event: KeyboardEvent, widget: ScreenWidget) => {
    const by = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!by) return;
    event.preventDefault();
    const p = placeScreenWidget(widget, grid);
    if (event.shiftKey) place(widget.id, { ...p, w: p.w + by[0]!, h: p.h + by[1]! });
    else place(widget.id, { ...p, x: Math.min(grid.columns - p.w, p.x + by[0]!), y: Math.min(grid.rows - p.h, p.y + by[1]!) });
  };

  return (
    // The container its sizes are measured against, as the screen's stage is: its own cq units would read the window.
    <div className="absolute inset-0 z-10 [container-type:size]">
    <div
      ref={ref}
      className="grid size-full"
      style={{
        padding: `${margin}cqh ${margin}cqw`,
        gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
        gap: `${grid.gap}cqmin`,
      }}
      onPointerMove={moveTo}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerDown={() => onSelect(null)}
      data-testid="theme-grid-overlay"
    >
      {/* The cells, faintly: where a widget can go. */}
      {Array.from({ length: grid.columns * grid.rows }, (_, i) => (
        <div key={`cell-${i}`} className="pointer-events-none rounded-[2px] border border-dashed border-white/15" style={{ gridColumn: (i % grid.columns) + 1, gridRow: Math.floor(i / grid.columns) + 1 }} aria-hidden />
      ))}
      {grid.widgets.map((widget) => {
        const p = placeScreenWidget(widget, grid);
        const picked = widget.id === selected;
        return (
          <div
            key={widget.id}
            role="button"
            tabIndex={0}
            aria-pressed={picked}
            aria-label={t(`screens.widgetKinds.${widget.kind}.name`)}
            className={cn(
              "relative cursor-move touch-none rounded-sm border-2 outline-none select-none",
              picked ? "border-sky-400 bg-sky-400/15" : "border-white/40 hover:border-white/80",
            )}
            style={{ gridColumn: `${p.x + 1} / span ${p.w}`, gridRow: `${p.y + 1} / span ${p.h}` }}
            onPointerDown={(event) => start(event, widget, false)}
            onKeyDown={(event) => keys(event, widget)}
            data-testid={`grid-widget-${widget.kind}`}
            data-place={`${p.x},${p.y},${p.w},${p.h}`}
          >
            <span className="absolute top-0.5 left-1 rounded bg-black/70 px-1 text-[10px] leading-4 font-medium text-white">{t(`screens.widgetKinds.${widget.kind}.name`)}</span>
            <span
              className="absolute right-0 bottom-0 size-3 cursor-se-resize rounded-tl bg-sky-400"
              onPointerDown={(event) => start(event, widget, true)}
              data-testid={`grid-widget-resize-${widget.kind}`}
              aria-hidden
            />
          </div>
        );
      })}
    </div>
    </div>
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

function Check({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (checked: boolean) => void; testId?: string }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" className="accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      {label}
    </label>
  );
}

function NumberInput({ value, min, max, onChange, testId }: { value: number; min: number; max: number; onChange: (value: number) => void; testId?: string }) {
  return (
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const number = Math.round(Number(e.target.value));
        if (Number.isFinite(number) && number >= min && number <= max) onChange(number);
      }}
      data-testid={testId}
    />
  );
}
