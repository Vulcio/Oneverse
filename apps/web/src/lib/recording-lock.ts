import { toast } from "@oneverse/ui/components/toast";
import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

/**
 * While a take records (issue #501), nothing else in Songverse plays over
 * it: the stems, the metronome and videos refuse to start, and say why. The
 * recorder plays the multitrack itself (`playStems(song, from, { take: true })`).
 */
let recording = false;
const listeners = new Set<() => void>();

export function setRecordingTake(next: boolean) {
  if (recording === next) return;
  recording = next;
  for (const listener of listeners) listener();
}

export function isRecordingTake(): boolean {
  return recording;
}

export function useRecordingTake(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => recording,
    () => false,
  );
}

const refusals = new Set<() => void>();

/** True, and says so, when a take is recording: what was about to play waits. */
export function refusedWhileRecording(): boolean {
  if (!recording) return false;
  for (const refused of refusals) refused();
  return true;
}

/** In the app, once: says why nothing played. */
export function useRecordingLockNotice() {
  const { t } = useTranslation();
  useEffect(() => {
    const say = () => toast(t("recorder.lock.refused"), { id: "recording-lock" });
    refusals.add(say);
    return () => {
      refusals.delete(say);
    };
  }, [t]);
}
