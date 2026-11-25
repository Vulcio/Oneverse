import type { AppKey, AppLink } from "@oneverse/core";

/** The pages Plan, Songverse and Oneverse's home share (their paths match, issue #241): a team, an organisation, a date… */
const PLANNING = /^\/(calendar|teams|organizations|notifications)(\/|$)/;
const DATE = /^\/events\/[^/]+\/[^/]+\/?$/;
const SET = /^\/sets\/([^/]+)/;
const CONSOLE_SET = /^\/operate\/([^/]+)/;

/**
 * Where switching to `to` from `pathname` lands (issue #552): the same place
 * where the other app has it - a team, an organisation, a date, the
 * calendar between Plan and Songverse, a date from the home, a set between
 * Songverse, the home's running order (issue #521) and the screens' console
 * - otherwise the app's home.
 */
export function appPath(to: AppKey, pathname: string): string {
  const set = SET.exec(pathname)?.[1] ?? CONSOLE_SET.exec(pathname)?.[1];
  switch (to) {
    case "oneverse":
      // A set: its running order (issue #521).
      if (set) return `/sets/${set}`;
      return DATE.test(pathname) ? pathname : "/";
    case "plan":
      return PLANNING.test(pathname) || DATE.test(pathname) ? pathname : "/calendar";
    case "songverse":
      if (PLANNING.test(pathname) || DATE.test(pathname)) return pathname;
      return set ? `/sets/${set}` : "/";
    case "screen":
      return set && SET.test(pathname) ? `/operate/${set}` : "/operate";
  }
}

/** An app's address at the place `appPath` finds. */
export function appHref(link: AppLink, pathname: string): string {
  const path = appPath(link.app, pathname);
  return path === "/" ? link.url : `${link.url}${path}`;
}

let loaded: Promise<AppLink[]> | null = null;

/** The apps they can open (issue #552), asked once a page load: the hub's tiles and the switcher. */
export function loadApps(api: { listMyApps(): Promise<AppLink[]> }): Promise<AppLink[]> {
  loaded ??= api.listMyApps().catch((error: unknown) => {
    loaded = null;
    throw error;
  });
  return loaded;
}
