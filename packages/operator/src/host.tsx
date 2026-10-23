import type { SyncMember, SyncPresenting, SyncSession, SyncStage, SyncStageCommand } from "@oneverse/core";
import { createContext, useContext, type ReactNode } from "react";

/**
 * The operator's console (issue #305) in an app: Songverse's
 * /sets/$id/operate, the screen app's /operate. The console only draws and
 * sends; the app gives it its live connection to the set - Songverse's sync
 * client (which also plays along), the screen app's presentation-only one
 * (lib/live-client.ts) - through this host.
 */
export interface OperatorLive {
  /** Connected and in the set. */
  ready: boolean;
  error: string | null;
  session: SyncSession | null;
  stage: SyncStage | null;
  members: SyncMember[];
  leading: boolean;
  /** May lead the set (can edit it): its tempo, and the whole lead. */
  canLead: boolean;
  /** May present now: control isn't locked to someone else. */
  canPresent: boolean;
  /** Runs screens: can edit the set, or has a role that runs screens. */
  canOperate: boolean;
  /** May route the screens now (issue #322): their layers and overlays, without presenting; left out by an older server. */
  canRoute?: boolean;
  /** This device runs the screens (session.screens). */
  screensMine: boolean;
  /** The server's clock less this device's (ms), once measured. */
  offset: number | null;
  /** A change this device made is on its way, not yet confirmed by the server (issue #247). */
  sending?: boolean;
  /** The set's Pulse's page with this person's pass (issue #247, core's PulseDoor): "Continue on Pulse" while the cloud's gone. */
  pulseLink?: string | null;
}

export interface OperatorHost {
  /** The live state, fresh on each render (a hook of the app's). */
  useLive: () => OperatorLive;
  /** What the screens show, based on what they showed (the app's client adds the revision). */
  present: (presenting: SyncPresenting | null) => void;
  /** Takes the screens - shared, or locked to this device - or (null) gives them back. */
  takeScreens: (control: "shared" | "exclusive" | null) => void;
  /** The stage's timer, message and layers. */
  sendStage: (command: SyncStageCommand) => void;
  /** Takes the whole lead (tempo too), where the app can play along; left out, the console doesn't offer it. */
  lead?: () => void;
  /** The screens & layers panel opened beside the page, on a large screen: the app makes room for it. */
  usePanelRoom?: (open: boolean) => void;
}

const OperatorContext = createContext<OperatorHost | null>(null);

export function OperatorProvider({ host, children }: { host: OperatorHost; children: ReactNode }) {
  return <OperatorContext.Provider value={host}>{children}</OperatorContext.Provider>;
}

export function useOperatorHost(): OperatorHost {
  const host = useContext(OperatorContext);
  if (!host) throw new Error("The operator's console needs an OperatorProvider");
  return host;
}

/** The live state, from the app's connection. */
export function useLive(): OperatorLive {
  return useOperatorHost().useLive();
}
