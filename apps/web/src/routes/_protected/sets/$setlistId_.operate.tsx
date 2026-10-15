import { formatTimer, lyricSlides, readSyncTimer, renderChart, SYNC_STAGE_MESSAGE_MAX, type SetlistOfflineCopy, type SyncStageCommand } from "@songverse/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Minus, MonitorUp, Pause, Play, Plus, RotateCcw, Send, Timer, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { apiClient } from "#/lib/api-client";
import { disableSync, enableSync, sendStage, syncState, useSync } from "#/lib/sync-client";
import { setlistTitle } from "#/lib/setlists";
import { cn } from "@songverse/ui/lib/utils";

export const Route = createFileRoute("/_protected/sets/$setlistId_/operate")({
  loader: async ({ params }) => ({ copy: await apiClient.getSetlistOffline(params.setlistId) }),
  component: OperatorPage,
});

/** A countdown's lengths, one press away (minutes). */
const PRESETS = [1, 3, 5, 10, 15, 30];
/** Quick messages' keys in the locale files (`screens.operator.quick.<key>`). */
const QUICK = ["wrapUp", "oneMinute", "nextSong", "louder", "slowDown", "repeat"] as const;

/**
 * The media operator's view of a set (issue #269): what its screens show,
 * the timer the stage displays read - a countdown or a count up, started,
 * paused, reset, a minute more or less - and a message to the stage. It
 * follows the set without playing along (no metronome, no stems), and needs
 * no lead: anyone who can lead the set runs it, while someone else leads.
 */
function OperatorPage() {
  const { t, i18n } = useTranslation();
  const { setlistId } = Route.useParams();
  const { copy } = Route.useLoaderData();
  const sync = useSync();
  useEffect(() => {
    // Turned on here: off again on leaving; already on (from Live), left as it was.
    const wasOn = syncState().setId === setlistId;
    enableSync(setlistId, false, { follow: false });
    return () => {
      if (!wasOn) disableSync();
    };
  }, [setlistId]);
  const ready = sync.setId === setlistId && sync.status === "on";
  const send = (command: SyncStageCommand) => sendStage(command);
  const screens = sync.members.filter((member) => member.screen);

  return (
    <div className="flex flex-col gap-6" data-testid="operator">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" render={<Link to="/sets/$setlistId" params={{ setlistId }} aria-label={t("screens.operator.back")} />}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{t("screens.operator.title")}</h1>
          <p className="text-sm text-muted-foreground">{setlistTitle(copy.set, t, i18n.language)}</p>
        </div>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="operator-screens">
          <MonitorUp className="size-4" aria-hidden />
          {screens.length === 0 ? t("screens.noScreens") : `${t("screens.screenCount", { count: screens.length })} · ${screens.map((one) => one.name).join(", ")}`}
        </p>
      </div>

      {!ready ? (
        <p className="text-sm text-muted-foreground">{sync.error ?? t("screens.operator.connecting")}</p>
      ) : !sync.canLead ? (
        <p className="text-sm text-muted-foreground" data-testid="operator-not-allowed">
          {t("screens.operator.notAllowed")}
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <OnScreens copy={copy} />
          <TimerCard send={send} />
          <MessageCard send={send} />
        </div>
      )}
    </div>
  );
}

/** What the screens show now: the song and its slide, or nothing presented. */
function OnScreens({ copy }: { copy: SetlistOfflineCopy }) {
  const { t } = useTranslation();
  const { session } = useSync();
  const presenting = session?.presenting ?? null;
  const view = presenting ? copy.songs.find((one) => one.item.id === presenting.itemId) : undefined;
  const slides = useMemo(
    () => (view?.song ? lyricSlides(renderChart(view.song.document, view.arrangement?.document ?? null, { transposeSteps: view.item.transposeSteps })) : []),
    [view],
  );
  const slide = presenting ? slides[presenting.slide] : undefined;
  return (
    <Card className="lg:col-span-2" data-testid="operator-on-screens">
      <CardHeader>
        <CardTitle className="text-base">{t("screens.operator.onScreens")}</CardTitle>
      </CardHeader>
      <CardContent>
        {!presenting || !view?.song ? (
          <p className="text-sm text-muted-foreground">{t("screens.operator.notPresenting")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {view.song.title} · {t("screens.slideOf", { slide: presenting.slide + 1, count: slides.length })}
              {presenting.black ? ` · ${t("screens.black")}` : ""}
            </p>
            <p className={cn("text-lg", presenting.black && "opacity-40")}>{slide?.lines.join(" / ") || t("screens.noWords")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The stage's timer: what it shows now, and its controls. */
function TimerCard({ send }: { send: (command: SyncStageCommand) => void }) {
  const { t } = useTranslation();
  const { stage, offset } = useSync();
  const timer = stage?.timer ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);
  const [minutes, setMinutes] = useState("");
  const reading = timer ? readSyncTimer(timer, now + (offset ?? 0)) : null;

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
          className={cn("text-center font-mono text-6xl font-semibold tabular-nums", !timer && "text-muted-foreground", reading?.overtime && "text-red-500", reading?.warn && "text-amber-500")}
          data-testid="operator-timer-readout"
          data-running={reading?.running ? "" : undefined}
        >
          {reading ? formatTimer(reading.seconds, reading.overtime) : "–:––"}
        </p>
        <p className="text-center text-xs text-muted-foreground">
          {!timer ? t("screens.operator.noTimer") : timer.kind === "countdown" ? t("screens.operator.countdownOf", { time: formatTimer(timer.duration) }) : t("screens.operator.countUp")}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button disabled={!timer} onClick={() => send({ run: !timer?.startedAt })} data-testid="operator-timer-run">
            {timer?.startedAt ? <Pause /> : <Play />}
            {timer?.startedAt ? t("screens.operator.pause") : t("screens.operator.start")}
          </Button>
          <Button variant="outline" disabled={!timer} onClick={() => send({ reset: true })} data-testid="operator-timer-reset">
            <RotateCcw />
            {t("screens.operator.reset")}
          </Button>
          <Button variant="outline" size="icon" disabled={!timer} onClick={() => send({ add: -60 })} aria-label={t("screens.operator.minuteLess")}>
            <Minus />
          </Button>
          <Button variant="outline" size="icon" disabled={!timer} onClick={() => send({ add: 60 })} aria-label={t("screens.operator.minuteMore")} data-testid="operator-timer-more">
            <Plus />
          </Button>
          <Button variant="ghost" disabled={!timer} onClick={() => send({ timer: null })} data-testid="operator-timer-clear">
            <X />
            {t("screens.operator.clearTimer")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {PRESETS.map((one) => (
            <Button key={one} size="sm" variant="outline" onClick={() => send({ timer: { kind: "countdown", duration: one * 60 } })} data-testid={`operator-preset-${one}`}>
              {formatTimer(one * 60)}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => send({ timer: { kind: "count-up", duration: 0 }, run: true })} data-testid="operator-count-up">
            {t("screens.operator.countUp")}
          </Button>
          <form className="flex items-center gap-1" onSubmit={custom}>
            <Input type="number" min={1} max={1440} step="any" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder={t("screens.operator.minutes")} className="h-8 w-24" data-testid="operator-custom-minutes" />
            <Button size="sm" type="submit" variant="secondary" disabled={!minutes} data-testid="operator-custom-set">
              {t("screens.operator.set")}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

/** A message to the stage: typed, or one of the quick ones; on the screens until it's cleared. */
function MessageCard({ send }: { send: (command: SyncStageCommand) => void }) {
  const { t } = useTranslation();
  const { stage } = useSync();
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
          {QUICK.map((key) => (
            <Button key={key} size="sm" variant="outline" onClick={() => send({ message: t(`screens.operator.quick.${key}`) })} data-testid={`operator-quick-${key}`}>
              {t(`screens.operator.quick.${key}`)}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
