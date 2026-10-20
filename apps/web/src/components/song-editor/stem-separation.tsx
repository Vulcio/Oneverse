import type { Attachment, StemSeparationParts, StemSeparations } from "@songverse/core";
import { useRouter } from "@tanstack/react-router";
import { AudioWaveform } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { apiClient } from "#/lib/api-client";

/** Still to come from the server: the quick stems, or the finer ones that replace them. */
const working = (separation: StemSeparations["separations"][number]) =>
  separation.status === "QUEUED" || separation.status === "SUBMITTED" || (separation.status === "FAST_READY" && separation.hqRequested && !separation.hqDone);

/**
 * The song's stem separations (issue #63), looked at again while one is
 * under way - every 10 seconds for the quick stems, every minute while
 * only the finer ones are awaited - and the song's files with them when
 * one changes, so its new multitrack shows up.
 */
export function useStemSeparations(songVersionId: string, enabled: boolean) {
  const router = useRouter();
  const [state, setState] = useState<StemSeparations | null>(null);
  const [tick, setTick] = useState(0);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    apiClient
      .listStemSeparations(songVersionId)
      .then((next) => {
        if (stale) return;
        setState(next);
        const statuses = next.separations.map((separation) => `${separation.id}:${separation.status}:${separation.hqDone}`).join(",");
        if (seen.current !== null && seen.current !== statuses) void router.invalidate();
        seen.current = statuses;
      })
      .catch(() => {
        // Offline, or not for this viewer: nothing to show.
      });
    return () => {
      stale = true;
    };
  }, [songVersionId, enabled, tick]);
  const pending = state?.separations.filter(working) ?? [];
  const quick = pending.some((separation) => separation.status !== "FAST_READY");
  useEffect(() => {
    if (pending.length === 0) return;
    const timer = setTimeout(() => setTick((value) => value + 1), quick ? 10_000 : 60_000);
    return () => clearTimeout(timer);
  }, [state]);
  return { state, refresh: () => setTick((value) => value + 1) };
}

/** Splits a recording into stems: how many parts, a word on rights, then off to the server. */
export function SeparateButton({
  file,
  busy,
  canReplace,
  server = null,
  onStart,
}: {
  file: Attachment;
  busy: boolean;
  /** Whose Sonic server it goes to (issue #300): a team's or an organisation's; null for the instance's. */
  server?: StemSeparations["server"];
  /** The recording already has separated stems on the song: the new ones can replace them (issue #175). */
  canReplace: boolean;
  onStart: (parts: StemSeparationParts, replace: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<StemSeparationParts>("4");
  const [replace, setReplace] = useState(true);
  const [starting, setStarting] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="self-start" disabled={busy || file.processing === "PENDING"} onClick={() => setOpen(true)} data-testid="separate-stems">
        <AudioWaveform />
        {t("separation.button")}
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm" data-testid="separate-options">
      <span className="font-medium">{t("separation.title")}</span>
      <span className="text-xs text-muted-foreground">{t("separation.description", { name: file.filename })}</span>
      {server ? (
        <span className="text-xs text-muted-foreground" data-testid="separate-server">
          {t(`separation.onServer_${server.kind}`, { name: server.name })}
        </span>
      ) : null}
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">{t("separation.parts")}</legend>
        {(["4", "6", "2"] as const).map((value) => (
          <label key={value} className="flex items-center gap-2 text-xs">
            <input type="radio" name={`parts-${file.id}`} value={value} checked={parts === value} onChange={() => setParts(value)} data-testid={`separate-parts-${value}`} />
            {t(`separation.parts${value}`)}
          </label>
        ))}
      </fieldset>
      {canReplace ? (
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={replace} onChange={(event) => setReplace(event.target.checked)} data-testid="separate-replace" />
          <span>
            {t("separation.replace")}
            <span className="block text-muted-foreground">{t("separation.replaceHint")}</span>
          </span>
        </label>
      ) : null}
      {/* No finer pass for 6 parts (issue #174). */}
      <span className="text-xs text-muted-foreground">{t(parts === "6" ? "separation.noHq6" : "separation.hq")}</span>
      <span className="text-xs text-muted-foreground">{t("separation.rights")}</span>
      <span className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || starting}
          onClick={async () => {
            setStarting(true);
            try {
              await onStart(parts, canReplace && replace);
              setOpen(false);
            } finally {
              setStarting(false);
            }
          }}
          data-testid="separate-start"
        >
          {t("separation.start")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t("separation.cancel")}
        </Button>
      </span>
    </div>
  );
}

/** Where each separation got to, with the failed ones to try again. */
export function SeparationList({ separations, attachments, busy, onRetry }: { separations: StemSeparations["separations"]; attachments: Attachment[]; busy: boolean; onRetry: (id: string) => void }) {
  const { t } = useTranslation();
  if (separations.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="separations">
      <span className="text-sm font-medium">{t("separation.heading")}</span>
      <ul className="flex flex-col gap-1">
        {separations.map((separation) => {
          const source = attachments.find((file) => file.id === separation.sourceAttachmentId);
          const models = separationModels(separation);
          return (
            <li key={separation.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid={`separation-${separation.status}`}>
              {/* Named after its recording, even once that's deleted (issue #175). */}
              <span className="min-w-0 flex-1 truncate">{t("separation.of", { name: source?.filename ?? separation.sourceFilename ?? "…", parts: separation.parts })}</span>
              <span className={separation.status === "FAILED" ? "text-destructive" : "text-muted-foreground"}>
                {t(`separation.status_${separation.status === "FAST_READY" && !(separation.hqRequested && !separation.hqDone) ? "COMPLETED" : separation.status}`)}
              </span>
              {separation.hqDone ? <HighQuality /> : null}
              {models ? <span className="basis-full text-muted-foreground" data-testid="separation-models">{t("separation.models", { models })}</span> : null}
              {separation.status === "FAILED" ? (
                <>
                  {separation.error ? <span className="basis-full text-muted-foreground">{separation.error}</span> : null}
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onRetry(separation.id)} data-testid="separation-retry">
                    {t("separation.retry")}
                  </Button>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The models a separation was sent with (issue #175): "htdemucs → htdemucs_ft"; null for one sent before they were kept. */
export function separationModels(separation: Pick<StemSeparations["separations"][number], "fastModel" | "hqModel">): string | null {
  if (!separation.fastModel) return null;
  return separation.hqModel ? `${separation.fastModel} → ${separation.hqModel}` : separation.fastModel;
}

/** Its finer pass is in (issue #175). */
export function HighQuality() {
  const { t } = useTranslation();
  return (
    <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary" data-testid="high-quality">
      {t("separation.highQuality")}
    </span>
  );
}
