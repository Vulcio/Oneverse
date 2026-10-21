import { offlinePins, type OfflinePin, type OfflinePinKind } from "@oneverse/core";
import { useRouteContext } from "@tanstack/react-router";
import { CircleCheck, CloudDownload } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { apiClient } from "#/lib/api-client";
import { deviceStorage, onOfflineSync, syncOffline } from "#/lib/offline-data";

/**
 * "Available offline" on a set or song, "Keep a local copy" on a songbook
 * (issue #52): kept on every device the user signs in on - the pin is
 * stored on the server - with its audio files too when asked for.
 */
export function OfflinePinButton({ kind, targetId }: { kind: OfflinePinKind; targetId: string }) {
  const { t } = useTranslation();
  const { session, offline } = useRouteContext({ from: "/_protected" });
  const [pin, setPin] = useState<OfflinePin | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // As of the device's last sync; refreshed when one ends.
  useEffect(() => {
    const load = () =>
      void offlinePins(deviceStorage())
        .then((pins) => setPin(pins.find((candidate) => candidate.kind === kind && candidate.targetId === targetId) ?? null))
        .catch(() => setPin(null));
    load();
    return onOfflineSync(load);
  }, [kind, targetId]);

  async function change(next: { pinned: boolean; includeAudio?: boolean }) {
    const before = pin;
    setPending(true);
    setError(null);
    // Shown at once; put back if the server says no.
    if (pin && next.pinned) setPin({ ...pin, includeAudio: next.includeAudio ?? false });
    try {
      if (next.pinned) setPin(await apiClient.pinOffline(kind, targetId, next.includeAudio ?? false));
      else {
        await apiClient.unpinOffline(kind, targetId);
        setPin(null);
      }
      // Downloads (or removes) it now, not at the next sync.
      void syncOffline(session.userId);
    } catch (err) {
      setPin(before);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  const label = kind === "SONGBOOK" ? t("offline.keepCopy") : t("offline.pin");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        aria-pressed={!!pin}
        disabled={pending || !!offline || pin === undefined}
        onClick={() => void change({ pinned: !pin })}
        data-testid="offline-pin"
      >
        {pin ? <CircleCheck className="text-primary" /> : <CloudDownload />}
        {label}
      </Button>
      {pin ? (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={pin.includeAudio}
            disabled={pending || !!offline}
            onChange={(event) => void change({ pinned: true, includeAudio: event.target.checked })}
          />
          {t("offline.includeAudio")}
        </label>
      ) : null}
      {error ? (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
