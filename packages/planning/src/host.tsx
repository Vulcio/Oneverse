import type { ApiClient } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";

/**
 * What the app showing the planning screens gives them (issue #241):
 * Songverse's web app, Planiverse's. Its API client, where its pages are,
 * and its sets - only Songverse has those.
 */
export interface PlanningHost {
  api: ApiClient;
  links: {
    /** Where one goes after leaving a team, */
    home: string;
    /** and after deleting one. */
    teams: string;
    organizations: string;
    team: (teamId: string) => string;
    organization: (organizationId: string) => string;
    organizationEvents: (organizationId: string) => string;
    /** The Notifications page (issue #149). */
    notifications: string;
    /**
     * Where a notification's path goes from here (issue #241): the same in
     * both apps, but a song's, a set's or People are Songverse's.
     */
    notification: (url: string) => string;
  };
  /** A date's set: where it opens, and whether one can be made here. Null in an app without sets. */
  sets: { href: (setlistId: string) => string; canMake: boolean } | null;
  /** Told when one's notifications change (issue #27): the bell reads its count again at once. Without it, the bell asks every minute. */
  watchNotifications?: (onChange: () => void) => () => void;
}

const HostContext = createContext<PlanningHost | null>(null);

export function PlanningProvider({ host, children }: { host: PlanningHost; children: ReactNode }) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

export function usePlanning(): PlanningHost {
  const host = useContext(HostContext);
  if (!host) throw new Error("The planning screens need a PlanningProvider");
  return host;
}

/** A link the host gave: in the app, or to another one (a set in Songverse, from Planiverse). */
export function HostLink({ href, ...props }: { href: string } & Omit<ComponentProps<"a">, "href">) {
  if (/^https?:\/\//.test(href)) return <a href={href} {...props} />;
  return <Link to={href} {...props} />;
}
