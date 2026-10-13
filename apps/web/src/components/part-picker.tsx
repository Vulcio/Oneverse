import { INSTRUMENT_PARTS, partKind, VOICE_PARTS, type PartKind, type StemPart } from "@songverse/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@songverse/ui/components/input";
import { NativeSelect } from "@songverse/ui/components/native-select";

export interface PartChoice {
  stemPart: StemPart | null;
  partName: string | null;
}

/** A part's name as shown (issue #131): its own, else the part's ("Harmony 2 (alto)"). */
export function usePartLabel() {
  const { t } = useTranslation();
  return (file: { stemPart: StemPart | null; partName?: string | null }) => file.partName || (file.stemPart ? t(`stems.parts.${file.stemPart}`) : t("stems.fullMix"));
}

const CUSTOM = "custom";

/**
 * Picks a part (issue #131): first a voice, an instrument or the cues,
 * then - a voice's part (the lead, a harmony, backing vocals) or a name of
 * one's own; an instrument, with a name if wanted; the cues' name.
 * `allowNone` adds "Not a stem" (a whole recording).
 */
export function PartPicker({
  value,
  onChange,
  label,
  allowNone = false,
  disabled = false,
  compact = false,
}: {
  value: PartChoice;
  onChange: (next: PartChoice) => void;
  /** What it's for: "Stem for …". */
  label: string;
  allowNone?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const kind: PartKind | "" = value.stemPart ? partKind(value.stemPart) : "";
  // A name is typed, then kept on blur or Enter.
  const [name, setName] = useState(value.partName ?? "");
  useEffect(() => setName(value.partName ?? ""), [value.partName]);
  // A voice of one's own naming, chosen before a name is typed.
  const [customVoice, setCustomVoice] = useState(false);
  const voiceValue = kind === "VOICE" && (value.partName || customVoice) ? CUSTOM : (value.stemPart ?? "");
  const commitName = () => {
    const next = name.trim() || null;
    if (next !== (value.partName ?? null)) onChange({ ...value, partName: next });
  };
  const nameInput = (placeholder: string) => (
    <Input
      value={name}
      maxLength={40}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={t("stems.partNameOf", { what: label })}
      className={compact ? "h-8 w-40 text-xs" : "w-44"}
      onChange={(event) => setName(event.target.value)}
      onBlur={commitName}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitName();
        }
      }}
      data-testid="part-name"
    />
  );

  return (
    <span className="flex flex-wrap items-center gap-2" data-testid="part-picker" data-part={value.stemPart ?? ""} data-name={value.partName ?? ""}>
      <NativeSelect
        compact={compact}
        value={kind}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const next = event.target.value as PartKind | "";
          setCustomVoice(false);
          onChange(next === "VOICE" ? { stemPart: "VOCALS", partName: null } : next === "INSTRUMENT" ? { stemPart: "OTHER", partName: null } : next === "CUES" ? { stemPart: "CLICK", partName: null } : { stemPart: null, partName: null });
        }}
        data-testid="part-kind"
      >
        {allowNone ? <option value="">{t("stems.notAStem")}</option> : null}
        <option value="VOICE">{t("stems.kinds.VOICE")}</option>
        <option value="INSTRUMENT">{t("stems.kinds.INSTRUMENT")}</option>
        <option value="CUES">{t("stems.kinds.CUES")}</option>
      </NativeSelect>
      {kind === "VOICE" ? (
        <>
          <NativeSelect
            compact={compact}
            value={voiceValue}
            disabled={disabled}
            aria-label={t("stems.voiceOf", { what: label })}
            onChange={(event) => {
              if (event.target.value === CUSTOM) {
                setCustomVoice(true);
                // A voice of its own: backing vocals, named.
                if (value.stemPart !== "BACKING_VOCALS") onChange({ stemPart: "BACKING_VOCALS", partName: value.partName });
                return;
              }
              setCustomVoice(false);
              onChange({ stemPart: event.target.value as StemPart, partName: null });
            }}
            data-testid="part-voice"
          >
            {VOICE_PARTS.map((part) => (
              <option key={part} value={part}>
                {t(`stems.parts.${part}`)}
              </option>
            ))}
            <option value={CUSTOM}>{t("stems.customVoice")}</option>
          </NativeSelect>
          {voiceValue === CUSTOM ? nameInput(t("stems.voiceNamePlaceholder")) : null}
        </>
      ) : kind === "INSTRUMENT" ? (
        <>
          <NativeSelect
            compact={compact}
            value={value.stemPart ?? "OTHER"}
            disabled={disabled}
            aria-label={t("stems.instrumentOf", { what: label })}
            onChange={(event) => onChange({ ...value, stemPart: event.target.value as StemPart })}
            data-testid="part-instrument"
          >
            {INSTRUMENT_PARTS.map((part) => (
              <option key={part} value={part}>
                {t(`stems.parts.${part}`)}
              </option>
            ))}
          </NativeSelect>
          {nameInput(t("stems.instrumentNamePlaceholder"))}
        </>
      ) : kind === "CUES" ? (
        nameInput(t("stems.cuesNamePlaceholder"))
      ) : null}
    </span>
  );
}
