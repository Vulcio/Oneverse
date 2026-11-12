import { customTuningFromNames, findTuning, TUNINGS, type InstrumentId } from "@oneverse/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { cn } from "@oneverse/ui/lib/utils";

const OWN = "__own__";
const NONE = "__none__";

/**
 * A tuning to choose (issue #355): the built-in ones, and one of your own
 * typed as its open strings ("D A D F# A D"), each in the octave nearest
 * the standard string. With `noneLabel`, choosing nothing is offered too
 * (an arrangement leaves each player their own).
 */
export function TuningPicker({
  instrument,
  value,
  onChange,
  noneLabel,
  id,
  className,
  testId = "tuning-picker",
  compact = false,
}: {
  instrument: InstrumentId;
  value: string | null;
  onChange: (tuning: string | null) => void;
  noneLabel?: string;
  id?: string;
  className?: string;
  testId?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const current = value ? findTuning(instrument, value) : null;
  const own = current && !TUNINGS[instrument].some((one) => one.id === current.id) ? current : null;
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const typed = text.trim() ? customTuningFromNames(instrument, text) : null;
  const selected = typing ? OWN : (current?.id ?? (noneLabel ? NONE : "standard"));

  function save() {
    if (!typed) return;
    // The strings of a built-in tuning are that tuning.
    onChange(findTuning(instrument, typed)?.id ?? typed);
    setTyping(false);
    setText("");
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <NativeSelect
        id={id}
        compact={compact}
        value={selected}
        onChange={(event) => {
          const next = event.target.value;
          if (next === OWN) {
            setTyping(true);
            setText(own ? own.name.replace(/([A-G][#b]?)/g, "$1 ").trim() : "");
          } else {
            setTyping(false);
            onChange(next === NONE ? null : next);
          }
        }}
        data-testid={testId}
      >
        {noneLabel ? <option value={NONE}>{noneLabel}</option> : null}
        {TUNINGS[instrument].map((tuning) => (
          <option key={tuning.id} value={tuning.id}>
            {tuning.name}
          </option>
        ))}
        {own ? <option value={own.id}>{t("tunings.own", { notes: own.name })}</option> : null}
        <option value={OWN}>{t("tunings.typeOwn")}</option>
      </NativeSelect>
      {typing ? (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1.5">
            <input
              value={text}
              autoFocus
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  save();
                } else if (event.key === "Escape") setTyping(false);
              }}
              placeholder={instrument === "ukulele" ? "A D F# B" : "D A D F# A D"}
              aria-label={t("tunings.strings")}
              maxLength={40}
              className={cn("h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 font-mono text-sm outline-none focus-visible:border-ring", text.trim() && !typed && "border-warning")}
              data-testid={`${testId}-own`}
            />
            <Button type="button" size="sm" className="h-8" disabled={!typed} onClick={save} data-testid={`${testId}-own-save`}>
              {t("tunings.use")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{text.trim() && !typed ? t("tunings.wrong", { count: TUNINGS[instrument][0]!.strings.length }) : t("tunings.ownHint", { count: TUNINGS[instrument][0]!.strings.length })}</p>
        </div>
      ) : null}
    </div>
  );
}
