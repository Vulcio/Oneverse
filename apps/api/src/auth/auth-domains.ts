/**
 * The parent domain the API and the web apps live under (api.songverse.one
 * + app.songverse.one, and Planiverse's address when it's deployed, issue
 * #241 -> songverse.one), for scoping the session cookie so each web app's
 * own server sees it too. BetterAuth's default when crossSubDomainCookies
 * has no explicit domain is AUTH_URL's full hostname, which would hide the
 * cookie from the web apps entirely. `undefined` when all share one host
 * (e.g. localhost in dev), where a plain host-only cookie already reaches
 * them all.
 */
export function sharedCookieDomain(authHostname: string, ...webHostnames: string[]): string | undefined {
  if (webHostnames.every((hostname) => hostname === authHostname)) return undefined;
  let shared = authHostname.split(".").reverse();
  for (const hostname of webHostnames) {
    const labels = hostname.split(".").reverse();
    let same = 0;
    while (same < shared.length && shared[same] === labels[same]) same++;
    shared = shared.slice(0, same);
  }
  if (shared.length < 2) {
    throw new Error(
      `AUTH_URL (${authHostname}) and the web apps (${webHostnames.join(", ")}: WEB_URL, PLANIVERSE_URL) must be subdomains of one parent domain ` +
        "(e.g. api.example.com and example.com) - the session cookie set by the API has to be readable by every web app.",
    );
  }
  return shared.reverse().join(".");
}

/**
 * The passkey relying-party ID: the same parent domain as the session
 * cookie, not a web app's own hostname. WebAuthn lets any subdomain use a
 * parent domain as its ID, and a passkey only works for the ID it was
 * registered with - so pinning it to songverse.one keeps every passkey
 * working when the web app moves between songverse.one and
 * app.songverse.one (#42), runs on a preview subdomain, or is Planiverse.
 */
export function passkeyRpId(authHostname: string, ...webHostnames: string[]): string {
  return sharedCookieDomain(authHostname, ...webHostnames) ?? webHostnames[0] ?? authHostname;
}

/**
 * The web apps that sign people in with BetterAuth's own cookie: Oneverse
 * when it's deployed (issue #303) - the apps then sign in through it, with
 * sessions of their own, and may be on any domain - else the apps
 * themselves, as before. The cookie's domain and the passkeys' relying
 * party are worked out from these and the API's host.
 */
export function signInOrigins(apps: { songverse: string; planiverse: string | null; oneverse: string | null }): string[] {
  const addresses = apps.oneverse ? [apps.oneverse] : [apps.songverse, apps.planiverse];
  return addresses.flatMap((address) => (address ? [new URL(address).origin] : []));
}
