import { partKind, type Attachment } from "@songverse/core";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";

type Step = "voice" | "level" | "noise";

/**
 * Cleans up an audio file afterwards (issue #132): RNNoise on a voice,
 * its level evened out, steady noise reduced - done in the background,
 * the file coming back as Opus in its place.
 */
export function CleanUp({ file, busy, onCleanUp }: { file: Attachment; busy: boolean; onCleanUp: (steps: Step[]) => void }) {
  const { t } = useTranslation();
  const voice = !!file.stemPart && partKind(file.stemPart) === "VOICE";
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<Set<Step>>(new Set(voice ? ["voice"] : ["level"]));
  const toggle = (step: Step, on: boolean) => {
    const next = new Set(steps);
    if (on) next.add(step);
    else next.delete(step);
    setSteps(next);
  };
  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="self-start" disabled={busy || file.processing === "PENDING"} onClick={() => setOpen(true)} data-testid="clean-up">
        <Sparkles />
        {t("recorder.cleanUp")}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border p-2 text-xs" data-testid="clean-up-options">
      {voice ? (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={steps.has("voice")} onChange={(event) => toggle("voice", event.target.checked)} data-testid="clean-up-voice" />
          {t("recorder.voiceCleanUp")}
        </label>
      ) : null}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={steps.has("level")} onChange={(event) => toggle("level", event.target.checked)} data-testid="clean-up-level" />
        {t("recorder.level")}
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={steps.has("noise")} onChange={(event) => toggle("noise", event.target.checked)} data-testid="clean-up-noise" />
        {t("recorder.noise")}
      </label>
      <span className="flex gap-2">
        <Button type="button" size="sm" disabled={busy || steps.size === 0} onClick={() => (setOpen(false), onCleanUp([...steps]))} data-testid="clean-up-start">
          {t("recorder.cleanUpStart")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t("recorder.cleanUpCancel")}
        </Button>
      </span>
    </div>
  );
}
