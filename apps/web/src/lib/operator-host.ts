import type { OperatorHost, OperatorLive } from "@oneverse/operator/host";
import { leadSync, presentScreens, sendStage, takeScreens, useSync } from "#/lib/sync-client";
import { useSidePanelRoom } from "#/lib/side-panel";
import { apiClient } from "#/lib/api-client";

const hosts = new Map<string, OperatorHost>();

/**
 * Songverse's sync client as the operator's host (issue #305), for a set:
 * the console on /sets/$id/operate, and the present controls at the bottom
 * of Live. One per set, so it's the same between renders.
 */
export function songverseOperatorHost(setId: string): OperatorHost {
  let host = hosts.get(setId);
  if (!host) {
    host = {
      useLive: (): OperatorLive => {
        const sync = useSync();
        return { ...sync, ready: sync.setId === setId && sync.status === "on" };
      },
      present: presentScreens,
      takeScreens,
      sendStage,
      lead: leadSync,
      usePanelRoom: useSidePanelRoom,
      presets: { load: () => apiClient.getOperatorPresets(setId), save: (data) => apiClient.saveOperatorPresets(setId, data) },
      listScreens: () => apiClient.listScreens(setId),
      screenLooks: () => apiClient.getSetScreenLooks(setId),
    };
    hosts.set(setId, host);
  }
  return host;
}
