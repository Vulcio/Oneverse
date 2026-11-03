import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { apiClient } from "#/lib/api-client";
import { onStoredTakes, storedTakes, uploadWaitingTakes, type StoredTake } from "#/lib/take-store";

/** How often takes waiting are sent again while the app is open and online. */
const RETRY_EVERY_MS = 60_000;

/**
 * Sends the takes waiting on this device (issue #365) while the signed-in
 * app is open: at launch, when the connection comes back, and every minute.
 */
export function useWaitingTakesUpload() {
  const { session, offline } = useRouteContext({ from: "/_protected" });
  useEffect(() => {
    if (offline) return;
    const send = () => {
      if (navigator.onLine !== false) void uploadWaitingTakes(session.userId, apiClient);
    };
    send();
    const timer = setInterval(send, RETRY_EVERY_MS);
    window.addEventListener("online", send);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", send);
    };
  }, [session.userId, offline]);
}

/** The takes kept on this device for a song (or all of the user's), kept current. */
export function useStoredTakes(songVersionId?: string): StoredTake[] {
  const { session } = useRouteContext({ from: "/_protected" });
  const [takes, setTakes] = useState<StoredTake[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void storedTakes(session.userId, songVersionId).then((list) => live && setTakes(list));
    load();
    const off = onStoredTakes(load);
    return () => {
      live = false;
      off();
    };
  }, [session.userId, songVersionId]);
  return takes;
}
