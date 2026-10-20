// The user documentation (apps/docs), published at docs.songverse.one in
// English (at the root) and French (under /fr/).
const DOCS_URL = "https://docs.songverse.one";

// The docs page for each part of the app, by the path it starts with.
const PAGES: [RegExp, string][] = [
  [/^\/library\/[^/]+\/arrangements\//, "versions"],
  // A song pulled up on its own in Live: Live is on the Sets page.
  [/^\/library\/[^/]+\/live/, "sets"],
  [/^\/library\/new/, "library"],
  [/^\/library\/artists/, "library"],
  [/^\/library\/progressions/, "library"],
  [/^\/library\/songs/, "library"],
  [/^\/library\/[^/]+/, "song-editor"],
  [/^\/library/, "library"],
  [/^\/sets\/[^/]+\/operate/, "screens"],
  [/^\/sets/, "sets"],
  [/^\/screens/, "screens"],
  [/^\/brands/, "brands"],
  [/^\/songbook/, "songbooks"],
  [/^\/teams/, "teams"],
  [/^\/organizations/, "organizations"],
  [/^\/join-organization/, "organizations"],
  [/^\/calendar/, "teams"],
  [/^\/(admin|review)/, "admin"],
  [/^\/dashboard/, "account"],
  [/^\/notifications/, "account"],
  [/^\/offline/, "offline"],
  [/^\/people/, "people"],
  [/^\/metronome/, "metronome"],
  [/^\/tuner/, "metronome"],
];

/**
 * What the docs show them (issue #160): the parts about what they can use -
 * "admin", "reviewer", "stems" - or "member" for none. The docs keep it on
 * the device; without it, they show a member's view.
 */
export function docsView(session: { isGlobalAdmin: boolean; isReviewer: boolean; canSeparateStems: boolean }): string {
  if (session.isGlobalAdmin) return "admin,reviewer,stems";
  const view = [session.isReviewer && "reviewer", session.canSeparateStems && "stems"].filter(Boolean);
  return view.length ? view.join(",") : "member";
}

/** The docs page about where the user is (the docs' home otherwise), in their language, showing what `view` can use. */
export function docsUrl(pathname: string, language: string, view?: string): string {
  const page = PAGES.find(([pattern]) => pattern.test(pathname))?.[1];
  const locale = language.startsWith("fr") ? "/fr" : "";
  return `${DOCS_URL}${locale}/${page ? `${page}/` : ""}${view ? `?view=${view}` : ""}`;
}
