import type { AvailabilityAnswer, MyEventAnswer } from "@oneverse/core";
import { Check, CircleHelp, MessageSquareText, Plane, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@oneverse/ui/components/popover";
import { Textarea } from "@oneverse/ui/components/textarea";
import { cn } from "@oneverse/ui/lib/utils";

const CHOICES: { answer: AvailabilityAnswer; key: string; icon: typeof Check; on: string }[] = [
  { answer: "AVAILABLE", key: "teamCalendar.answerAvailable", icon: Check, on: "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600/90" },
  { answer: "IF_NEEDED", key: "teamCalendar.answerIfNeeded", icon: CircleHelp, on: "border-amber-500 bg-amber-500 text-white hover:bg-amber-500/90" },
  { answer: "UNAVAILABLE", key: "teamCalendar.answerUnavailable", icon: X, on: "border-rose-600 bg-rose-600 text-white hover:bg-rose-600/90" },
];

/** The words for an answer: Available, If needed, Not available, or No answer. */
export function answerLabel(answer: AvailabilityAnswer | null, t: (key: string) => string): string {
  return answer ? t(CHOICES.find((choice) => choice.answer === answer)!.key) : t("teamCalendar.noAnswer");
}

/**
 * Someone's answer for a date (issue #235): Available, If needed or Not
 * available, pressed again to take it back; a note for the team's admins.
 * A date in days they're away shows Not available, marked Away, until they
 * answer it. `labels` shows the words beside the icons.
 */
export function EventAnswer({
  value,
  onAnswer,
  onClear,
  labels = false,
  label,
  disabled = false,
}: {
  value: MyEventAnswer;
  onAnswer: (answer: AvailabilityAnswer, note?: string | null) => Promise<unknown>;
  onClear: () => Promise<unknown>;
  labels?: boolean;
  /** What it's the answer for, for screen readers ("Your answer", "Answer for Sam"). */
  label: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(value.note ?? "");
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-answer={value.answer ?? "NONE"} data-away={value.away ? "" : undefined}>
      {/* With their words, on a narrow screen: the three share the width, their words on one line. */}
      <div className={cn("flex", labels && "w-full @lg:w-auto")} role="group" aria-label={label}>
        {CHOICES.map(({ answer, key, icon: Icon, on }, index) => {
          // Away isn't an answer given: the buttons stay unpressed, showing it greyed.
          const pressed = value.answer === answer && !value.away;
          return (
            <button
              key={answer}
              type="button"
              disabled={disabled || busy}
              aria-pressed={pressed}
              aria-label={t(key)}
              title={t(key)}
              onClick={() => void run(() => (pressed ? onClear() : onAnswer(answer)))}
              className={cn(
                "flex h-7 items-center gap-1 border px-2 text-xs whitespace-nowrap transition-colors disabled:opacity-50 [&_svg]:size-3.5",
                labels && "min-w-0 flex-1 justify-center @lg:flex-none",
                index === 0 && "rounded-l-md",
                index === CHOICES.length - 1 && "rounded-r-md",
                index > 0 && "-ml-px",
                pressed ? on : "bg-background hover:bg-muted",
                value.away && answer === "UNAVAILABLE" && "bg-muted text-muted-foreground",
              )}
              data-testid={`answer-${answer}`}
            >
              <Icon />
              {labels ? <span>{t(key)}</span> : null}
            </button>
          );
        })}
      </div>
      {value.away ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="answer-away">
          <Plane className="size-3" aria-hidden />
          {t("teamCalendar.away")}
        </span>
      ) : null}
      {value.answer && !value.away ? (
        <Popover
          open={noteOpen}
          onOpenChange={(open) => {
            setNoteOpen(open);
            if (open) setNote(value.note ?? "");
          }}
        >
          <PopoverTrigger
            render={
              <button
                type="button"
                className={cn("flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-3.5", value.note && "text-foreground")}
                aria-label={t("teamCalendar.answerNote")}
                title={value.note ?? t("teamCalendar.answerNote")}
                data-testid="answer-note"
              />
            }
          >
            <MessageSquareText />
            {value.note ? <span className="max-w-32 truncate">{value.note}</span> : null}
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-72 flex-col gap-2">
            <label className="text-xs font-medium" htmlFor="answer-note-text">
              {t("teamCalendar.answerNote")}
            </label>
            <Textarea id="answer-note-text" value={note} maxLength={300} rows={2} onChange={(event) => setNote(event.target.value)} />
            <Button
              size="sm"
              className="self-end"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await onAnswer(value.answer!, note.trim() || null);
                  setNoteOpen(false);
                })
              }
              data-testid="answer-note-save"
            >
              {t("teamCalendar.saveNote")}
            </Button>
          </PopoverContent>
        </Popover>
      ) : null}
      {value.byAdmin && !value.away ? <span className="text-xs text-muted-foreground italic">{t("teamCalendar.byAdmin")}</span> : null}
    </div>
  );
}
