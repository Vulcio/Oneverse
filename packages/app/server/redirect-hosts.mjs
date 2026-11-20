// Old addresses of a web app, sent on to its current one (#42): when
// Songverse moved from songverse.one to app.songverse.one, or Planiverse from
// planiverse.top to plan.oneverse.top as Oneverse Plan (#539), links already
// out there - verification and password-reset emails, set share links, claim
// links, bookmarks - still point at the old host.
//
// REDIRECT_HOSTS lists the old hostnames (comma-separated, e.g.
// "songverse.one"); the app's own address variable (WEB_URL for Songverse,
// PLANIVERSE_URL for Plan) is where it lives now. Unset, nothing is
// redirected.

/** A permanent redirect to the same path on the app's address (`env[addressVariable]`) for a request to one of REDIRECT_HOSTS, else null. */
export function redirectToWebUrl(request, env = process.env, addressVariable = "WEB_URL") {
  const hosts = (env.REDIRECT_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const address = env[addressVariable];
  if (hosts.length === 0 || !address) return null;
  const url = new URL(request.url);
  const host = (request.headers.get("host") ?? url.host).toLowerCase().replace(/:\d+$/, "");
  if (!hosts.includes(host)) return null;
  const target = new URL(url.pathname + url.search, /^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `https://${address}`);
  // 308 keeps the method and body of anything that isn't a plain page load.
  const status = request.method === "GET" || request.method === "HEAD" ? 301 : 308;
  return new Response(null, { status, headers: { Location: target.href } });
}
