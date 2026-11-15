import {
  formatTimer,
  readSyncLayers,
  readSyncTimer,
  stageTimers,
  SYNC_MAIN_TIMER,
  SYNC_STAGE_MESSAGE_MAX,
  SYNC_STAGE_TIMERS_MAX,
  type OperatorPresets,
  type OperatorTimerPreset,
  type SyncNamedTimer,
  type SyncStageCommand,
} from "@oneverse/core";
import { ChevronRight, Minus, Pause, Pencil, Play, Plus, RotateCcw, Send, Timer, Trash2, X } from "lucide-react";
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { Input } from "@oneverse/ui/components/input";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { cn } from "@oneverse/ui/lib/utils";
import { useLive, useOperatorHost } from "../host";
import { nextSlide, type OperatorItem } from "./operator-rundown";

/** The main timer's lengths, one press away (minutes). */
const LENGTHS = [1, 3, 5, 10, 15, 30];
/** The built-in quick messages' keys in the locale files (`screens.operator.quick.<key>`), until a team saves its own. */
const QUICK = ["wrapUp", "oneMinute", "nextSong", "louder", "slowDown", "repeat"] as const;
/** The built-in named timers (issue #358), until a team saves its own: names in the locale files (`screens.operator.timers.<key>`). */
const BUILT_IN_TIMERS = [
  { key: "service", kind: "count-up", duration: 0 },
  { key: "sermon", kind: "countdown", duration: 30 * 60 },
  { key: "announcements", kind: "countdown", duration: 5 * 60 },
] as const;

/** The server's clock now, ticking four times a second: what the timers read. */
function useServerNow(): number {
  const { offset } = useLive();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);
  return now + (offset ?? 0);
}

/**
 * The set's named timers and quick messages (issue #358): its owner's, from
 * the API through the host, the built-in ones while they aren't saved or
 * can't be read (offline, on Pulse).
 */
function useLoadPresets(): { presets: OperatorPresets | null; timers: OperatorTimerPreset[]; messages: { text: string; id: string }[]; save: ((data: Partial<Pick<OperatorPresets, "timers" | "messages">>) => Promise<void>) | null } {
  const { t } = useTranslation();
  const host = useOperatorHost().presets;
  const [presets, setPresets] = useState<OperatorPresets | null>(null);
  useEffect(() => {
    let live = true;
    host
      ?.load()
      .then((loaded) => live && setPresets(loaded))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [host]);
  const timers = presets?.timers ?? BUILT_IN_TIMERS.map((one) => ({ name: t(`screens.operator.timers.${one.key}`), kind: one.kind, duration: one.duration }));
  const messages = presets?.messages ? presets.messages.map((text, index) => ({ text, id: String(index) })) : QUICK.map((key) => ({ text: t(`screens.operator.quick.${key}`), id: key }));
  const save =
    host && presets?.canEdit
      ? async (data: Partial<Pick<OperatorPresets, "timers" | "messages">>) => {
          setPresets(await host.save(data));
        }
      : null;
  return { presets, timers, messages, save };
}

type LoadedPresets = ReturnType<typeof useLoadPresets>;
const PresetsContext = createContext<LoadedPresets | null>(null);

/** Loads the set's presets once for the whole console, so a change saved from one card shows in the other. */
export function OperatorPresetsProvider({ children }: { children: ReactNode }) {
  return <PresetsContext.Provider value={useLoadPresets()}>{children}</PresetsContext.Provider>;
}

function useOperatorPresets(): LoadedPresets {
  const presets = useContext(PresetsContext);
  if (!presets) throw new Error("The operator's cards need an OperatorPresetsProvider");
  return presets;
}

/**
 * What's on the screens and what comes next (issue #358): the slide up now,
 * blacked or with its words hidden, the message over it; the next one, sent
 * by its button or the arrow keys.
 */
export function ProgramCard({ items, itemId, compact = false }: { items: OperatorItem[]; itemId: string | null; compact?: boolean }) {
  const { t } = useTranslation();
  const { session, stage, canPresent } = useLive();
  const { present } = useOperatorHost();
  const presenting = session?.presenting ?? null;
  const item = presenting ? items.find((one) => one.itemId === presenting.itemId) : undefined;
  const slide = presenting && item ? item.slides[presenting.slide] : undefined;
  const section = item && presenting ? [...item.sections].reverse().find((one) => one.slide <= presenting.slide) : undefined;
  const layers = readSyncLayers(stage?.layers);
  const wordsHidden = layers.hidden.includes("content");
  const next = nextSlide(items, presenting, itemId);
  const nextLines = next?.item.slides[next.slide]?.lines ?? [];
  const goNext = () => next && present({ itemId: next.item.itemId, slide: next.slide, black: false, slideKey: next.item.key });
  return (
    <section className={cn("grid", compact ? "grid-cols-2 gap-2" : "gap-3 @2xl:grid-cols-[3fr_2fr]")} data-testid="operator-program">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <span className={cn("size-2 rounded-full", presenting && !presenting.black ? "bg-red-500" : "bg-muted-foreground/40")} aria-hidden />
          {t("screens.operator.onScreens")}
        </p>
        <div
          className="relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded-lg bg-black px-4 text-center text-white"
          data-testid="operator-on-screens"
          data-state={!presenting ? "none" : presenting.black ? "black" : wordsHidden ? "hidden" : "shown"}
        >
          {item && presenting ? (
            <>
              <span className="absolute top-2 left-2 max-w-[70%] truncate rounded bg-white/15 px-1.5 text-[10px] font-semibold tracking-wide uppercase">{section ? `${item.title} · ${section.label}` : item.title}</span>
              <span className="absolute top-2 right-2 text-[10px] text-white/70 tabular-nums">{t("screens.slideOf", { slide: presenting.slide + 1, count: item.slides.length })}</span>
              <div className={cn("flex flex-col gap-0.5 leading-snug", compact ? "px-1 pt-3 text-[11px]" : "text-sm @lg:text-base", (presenting.black || wordsHidden) && "opacity-25")}>
                {slide?.lines.length ? slide.lines.map((line, index) => <p key={index}>{line}</p>) : <p className="text-white/60 italic">{t("screens.noWords")}</p>}
              </div>
              {presenting.black ? <span className="absolute inset-x-0 bottom-2 text-xs font-semibold tracking-widest text-white/80 uppercase">{t("screens.black")}</span> : wordsHidden ? <span className="absolute inset-x-0 bottom-2 text-xs text-white/80">{t("screens.operator.wordsHidden")}</span> : null}
            </>
          ) : (
            <p className="text-sm text-white/60">{t("screens.operator.nothingUp")}</p>
          )}
          {stage?.message ? (
            <p className="absolute inset-x-0 bottom-0 truncate bg-red-600/90 px-2 py-0.5 text-xs" data-testid="operator-on-screens-message">
              {stage.message.text}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("screens.operator.next")}</p>
        <button
          type="button"
          disabled={!canPresent || !next}
          onClick={goNext}
          className="group relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-muted/40 px-3 text-center enabled:hover:border-primary disabled:cursor-not-allowed"
          data-testid="operator-next-slide"
          aria-label={next ? t("screens.operator.goNext", { title: next.item.title }) : t("screens.operator.noNext")}
        >
          {next ? (
            <>
              <span className="absolute top-1.5 left-2 max-w-[75%] truncate text-[10px] font-semibold text-muted-foreground uppercase">{next.item.itemId !== presenting?.itemId ? next.item.title : ([...next.item.sections].reverse().find((one) => one.slide <= next.slide)?.label ?? "")}</span>
              <span className={cn("flex flex-col leading-snug", compact ? "pt-3 text-[11px]" : "text-xs @lg:text-sm")}>
                {nextLines.length ? nextLines.map((line, index) => <span key={index}>{line}</span>) : <span className="text-muted-foreground italic">{t("screens.noWords")}</span>}
              </span>
              <span className="absolute right-1.5 bottom-1.5 flex items-center gap-0.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground opacity-80 group-enabled:group-hover:opacity-100">
                {t("screens.operator.go")}
                <ChevronRight className="size-3" aria-hidden />
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">{t("screens.operator.noNext")}</span>
          )}
        </button>
      </div>
    </section>
  );
}

/** A named timer's id (issue #358): the one already called that, else a new one. */
function timerIdFor(timers: SyncNamedTimer[], name: string): string {
  const same = timers.find((timer) => timer.id !== SYNC_MAIN_TIMER && timer.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
  return same?.id ?? `t-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The stage's timers (issues #269, #358): the main one - what an unnamed
 * countdown or count up widget shows - with its lengths one press away, and
 * the named ones started from the set's presets ("Sermon", "Service"), each
 * run, paused, reset or taken away on its own.
 */
export function TimersCard({ send }: { send: (command: SyncStageCommand) => void }) {
  const { t } = useTranslation();
  const { stage } = useLive();
  const now = useServerNow();
  const { timers: presets, presets: saved, save } = useOperatorPresets();
  const [editing, setEditing] = useState(false);
  const timers = stageTimers(stage);
  const main = timers.find((timer) => timer.id === SYNC_MAIN_TIMER) ?? null;
  const named = timers.filter((timer) => timer.id !== SYNC_MAIN_TIMER);
  const [minutes, setMinutes] = useState("");
  const reading = main ? readSyncTimer(main, now) : null;
  const full = timers.length >= SYNC_STAGE_TIMERS_MAX;

  function custom(event: FormEvent) {
    event.preventDefault();
    const value = Math.round(Number(minutes) * 60);
    if (value > 0 && value <= 86_400) {
      send({ timer: { kind: "countdown", duration: value } });
      setMinutes("");
    }
  }

  return (
    <Card data-testid="operator-timer">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Timer className="size-5" />
          {t("screens.operator.timer")}
        </CardTitle>
        <CardDescription>{t("screens.operator.timerDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p
          className={cn("text-center font-mono text-5xl font-semibold tabular-nums", !main && "text-muted-foreground", reading?.overtime && "text-red-500", reading?.warn && "text-amber-500")}
          data-testid="operator-timer-readout"
          data-running={reading?.running ? "" : undefined}
        >
          {reading ? formatTimer(reading.seconds, reading.overtime) : "–:––"}
        </p>
        <p className="text-center text-xs text-muted-foreground">{!main ? t("screens.operator.noTimer") : main.kind === "countdown" ? t("screens.operator.countdownOf", { time: formatTimer(main.duration) }) : t("screens.operator.countUp")}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button disabled={!main} onClick={() => send({ run: !main?.startedAt })} data-testid="operator-timer-run">
            {main?.startedAt ? <Pause /> : <Play />}
            {main?.startedAt ? t("screens.operator.pause") : t("screens.operator.start")}
          </Button>
          <Button variant="outline" disabled={!main} onClick={() => send({ reset: true })} data-testid="operator-timer-reset">
            <RotateCcw />
            {t("screens.operator.reset")}
          </Button>
          <Button variant="outline" size="icon" disabled={!main} onClick={() => send({ add: -60 })} aria-label={t("screens.operator.minuteLess")}>
            <Minus />
          </Button>
          <Button variant="outline" size="icon" disabled={!main} onClick={() => send({ add: 60 })} aria-label={t("screens.operator.minuteMore")} data-testid="operator-timer-more">
            <Plus />
          </Button>
          <Button variant="ghost" disabled={!main} onClick={() => send({ timer: null })} data-testid="operator-timer-clear">
            <X />
            {t("screens.operator.clearTimer")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {LENGTHS.map((one) => (
            <Button key={one} size="sm" variant="outline" disabled={full && !main} onClick={() => send({ timer: { kind: "countdown", duration: one * 60 } })} data-testid={`operator-preset-${one}`}>
              {formatTimer(one * 60)}
            </Button>
          ))}
          <Button size="sm" variant="outline" disabled={full && !main} onClick={() => send({ timer: { kind: "count-up", duration: 0 }, run: true })} data-testid="operator-count-up">
            {t("screens.operator.countUp")}
          </Button>
          <form className="flex items-center gap-1" onSubmit={custom}>
            <Input type="number" min={1} max={1440} step="any" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder={t("screens.operator.minutes")} className="h-8 w-24" data-testid="operator-custom-minutes" />
            <Button size="sm" type="submit" variant="secondary" disabled={!minutes} data-testid="operator-custom-set">
              {t("screens.operator.set")}
            </Button>
          </form>
        </div>

        <div className="flex flex-col gap-2 border-t pt-4" data-testid="operator-named-timers">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 text-sm font-semibold">{t("screens.operator.namedTimers")}</h3>
            {save ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} data-testid="operator-presets-edit">
                <Pencil />
                {t("screens.operator.editPresets")}
              </Button>
            ) : null}
          </div>
          {named.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {named.map((timer) => (
                <NamedTimer key={timer.id} timer={timer} now={now} send={send} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{t("screens.operator.namedTimersHint")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.name}
                size="sm"
                variant="outline"
                disabled={full && !named.some((timer) => timer.name.trim().toLocaleLowerCase() === preset.name.trim().toLocaleLowerCase())}
                onClick={() => send({ timerId: timerIdFor(timers, preset.name), timer: { kind: preset.kind, duration: preset.duration, name: preset.name }, run: true })}
                data-testid="operator-timer-preset"
                data-name={preset.name}
              >
                <Play />
                {preset.name}
                <span className="text-muted-foreground tabular-nums">{preset.kind === "countdown" ? formatTimer(preset.duration) : "↑"}</span>
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
      {save && saved ? <PresetsDialog open={editing} onOpenChange={setEditing} presets={saved} timers={presets} save={save} /> : null}
    </Card>
  );
}

/** One named timer's row: its name and time, run or pause, reset, a minute more, taken away. */
function NamedTimer({ timer, now, send }: { timer: SyncNamedTimer; now: number; send: (command: SyncStageCommand) => void }) {
  const { t } = useTranslation();
  const reading = readSyncTimer(timer, now);
  const command = (change: Omit<SyncStageCommand, "timerId">) => send({ timerId: timer.id, ...change });
  return (
    <li className="flex items-center gap-1.5 rounded-md border px-2 py-1" data-testid="operator-named-timer" data-name={timer.name} data-running={reading.running ? "" : undefined}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium text-muted-foreground" title={timer.name}>
          {timer.name}
        </span>
        <span className={cn("font-mono text-lg leading-tight font-semibold tabular-nums", reading.overtime && "text-red-500", reading.warn && "text-amber-500")} data-testid="operator-named-timer-readout">
          {formatTimer(reading.seconds, reading.overtime)}
        </span>
      </span>
      <Button size="icon" variant="ghost" className="size-8" onClick={() => command({ run: !timer.startedAt })} aria-label={timer.startedAt ? t("screens.operator.pause") : t("screens.operator.start")} data-testid="operator-named-timer-run">
        {timer.startedAt ? <Pause /> : <Play />}
      </Button>
      <Button size="icon" variant="ghost" className="size-8" onClick={() => command({ reset: true })} aria-label={t("screens.operator.reset")}>
        <RotateCcw />
      </Button>
      <Button size="icon" variant="ghost" className="size-8" onClick={() => command({ add: 60 })} aria-label={t("screens.operator.minuteMore")}>
        <Plus />
      </Button>
      <Button size="icon" variant="ghost" className="size-8" onClick={() => command({ timer: null })} aria-label={t("screens.operator.removeTimer", { name: timer.name })} data-testid="operator-named-timer-remove">
        <X />
      </Button>
    </li>
  );
}

/** A message to the stage (issue #269): typed, or one of the set's quick ones (issue #358); on the screens until it's cleared. */
export function MessageCard({ send }: { send: (command: SyncStageCommand) => void }) {
  const { t } = useTranslation();
  const { stage } = useLive();
  const { messages, presets, timers, save } = useOperatorPresets();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const shown = stage?.message?.text ?? null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    send({ message: text });
    setText("");
  };
  return (
    <Card data-testid="operator-message">
      <CardHeader>
        <CardTitle className="text-base">{t("screens.operator.message")}</CardTitle>
        <CardDescription>{t("screens.operator.messageDescription")}</CardDescription>
        {save ? (
          <div data-slot="card-action" className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} data-testid="operator-messages-edit">
              <Pencil />
              {t("screens.operator.editPresets")}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className={cn("flex min-h-12 items-center gap-2 rounded-md border px-3 py-2", shown ? "border-red-500/50 bg-red-500/10" : "text-muted-foreground")} data-testid="operator-message-shown">
          <p className="min-w-0 flex-1 text-sm">{shown ?? t("screens.operator.noMessage")}</p>
          {shown ? (
            <Button size="sm" variant="outline" onClick={() => send({ message: null })} data-testid="operator-message-clear">
              {t("screens.operator.clearMessage")}
            </Button>
          ) : null}
        </div>
        <form className="flex gap-2" onSubmit={submit}>
          <Input value={text} maxLength={SYNC_STAGE_MESSAGE_MAX} onChange={(e) => setText(e.target.value)} placeholder={t("screens.operator.messagePlaceholder")} aria-label={t("screens.operator.message")} data-testid="operator-message-input" />
          <Button type="submit" disabled={!text.trim()} data-testid="operator-message-send">
            <Send />
            {t("screens.operator.send")}
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {messages.map((message) => (
            <Button key={message.id} size="sm" variant="outline" className="h-auto min-h-8 max-w-full py-1 text-left whitespace-normal" onClick={() => send({ message: message.text })} data-testid={`operator-quick-${message.id}`} data-quick="">
              {message.text}
            </Button>
          ))}
        </div>
      </CardContent>
      {save && presets ? <PresetsDialog open={editing} onOpenChange={setEditing} presets={presets} timers={timers} save={save} /> : null}
    </Card>
  );
}

interface TimerRow {
  name: string;
  kind: OperatorTimerPreset["kind"];
  minutes: string;
}

/**
 * The set's named timers and quick messages, edited (issue #358): for every
 * set of its team, or of the person whose set it is. Saved at once; each list
 * can go back to the built-in one.
 */
function PresetsDialog({
  open,
  onOpenChange,
  presets,
  timers,
  save,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: OperatorPresets;
  timers: OperatorTimerPreset[];
  save: (data: Partial<Pick<OperatorPresets, "timers" | "messages">>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<TimerRow[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { messages: shown } = useOperatorPresetsShown(presets);
  useEffect(() => {
    if (!open) return;
    setRows(timers.map((one) => ({ name: one.name, kind: one.kind, minutes: one.kind === "countdown" ? String(Math.round((one.duration / 60) * 100) / 100) : "" })));
    setMessages(shown);
    setError(null);
    // Filled each time it opens, from what's saved then.
  }, [open]);
  const set = (index: number, change: Partial<TimerRow>) => setRows((all) => all.map((row, i) => (i === index ? { ...row, ...change } : row)));
  async function submit(event: FormEvent) {
    event.preventDefault();
    const kept = rows.filter((row) => row.name.trim());
    const names = new Set<string>();
    for (const row of kept) {
      const name = row.name.trim().toLocaleLowerCase();
      if (names.has(name)) return setError(t("screens.operator.presets.sameName", { name: row.name.trim() }));
      names.add(name);
    }
    const nextTimers = kept.map((row) => ({ name: row.name.trim(), kind: row.kind, duration: row.kind === "countdown" ? Math.max(1, Math.min(86_400, Math.round(Number(row.minutes || 0) * 60))) : 0 }));
    setSaving(true);
    try {
      await save({ timers: nextTimers, messages: messages.map((one) => one.trim()).filter(Boolean) });
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  }
  async function builtIn() {
    setSaving(true);
    try {
      await save({ timers: null, messages: null });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" data-testid="operator-presets">
        <DialogHeader>
          <DialogTitle>{t("screens.operator.presets.title")}</DialogTitle>
          <DialogDescription>{presets.owner.kind === "team" ? t("screens.operator.presets.forTeam", { team: presets.owner.name }) : t("screens.operator.presets.forYou")}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">{t("screens.operator.namedTimers")}</legend>
            {rows.map((row, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2" data-testid="operator-presets-timer">
                <Input value={row.name} maxLength={40} onChange={(e) => set(index, { name: e.target.value })} placeholder={t("screens.operator.presets.timerName")} aria-label={t("screens.operator.presets.timerName")} className="h-8 min-w-0 flex-1 basis-40" data-testid="operator-presets-timer-name" />
                <NativeSelect value={row.kind} onChange={(e) => set(index, { kind: e.target.value as TimerRow["kind"] })} aria-label={t("screens.operator.presets.kind")} compact data-testid="operator-presets-timer-kind">
                  <option value="countdown">{t("screens.operator.presets.countdown")}</option>
                  <option value="count-up">{t("screens.operator.countUp")}</option>
                </NativeSelect>
                {row.kind === "countdown" ? (
                  <Input type="number" min={1} max={1440} step="any" value={row.minutes} onChange={(e) => set(index, { minutes: e.target.value })} aria-label={t("screens.operator.minutes")} placeholder={t("screens.operator.minutes")} className="h-8 w-24" data-testid="operator-presets-timer-minutes" />
                ) : null}
                <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => setRows((all) => all.filter((_, i) => i !== index))} aria-label={t("screens.operator.presets.remove")}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="self-start" disabled={rows.length >= 12} onClick={() => setRows((all) => [...all, { name: "", kind: "countdown", minutes: "5" }])} data-testid="operator-presets-add-timer">
              <Plus />
              {t("screens.operator.presets.addTimer")}
            </Button>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">{t("screens.operator.presets.messages")}</legend>
            {messages.map((message, index) => (
              <div key={index} className="flex items-center gap-2" data-testid="operator-presets-message">
                <Input value={message} maxLength={SYNC_STAGE_MESSAGE_MAX} onChange={(e) => setMessages((all) => all.map((one, i) => (i === index ? e.target.value : one)))} aria-label={t("screens.operator.presets.message")} className="h-8" data-testid="operator-presets-message-text" />
                <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => setMessages((all) => all.filter((_, i) => i !== index))} aria-label={t("screens.operator.presets.remove")}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="self-start" disabled={messages.length >= 20} onClick={() => setMessages((all) => [...all, ""])} data-testid="operator-presets-add-message">
              <Plus />
              {t("screens.operator.presets.addMessage")}
            </Button>
          </fieldset>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" disabled={saving || (!presets.timers && !presets.messages)} onClick={builtIn} data-testid="operator-presets-built-in">
              <RotateCcw />
              {t("screens.operator.presets.builtIn")}
            </Button>
            <Button type="submit" disabled={saving} data-testid="operator-presets-save">
              {t("screens.operator.presets.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The quick messages' words as they're shown: the saved ones, else the built-in ones in the reader's language. */
function useOperatorPresetsShown(presets: OperatorPresets) {
  const { t } = useTranslation();
  return { messages: presets.messages ?? QUICK.map((key) => t(`screens.operator.quick.${key}`)) };
}
