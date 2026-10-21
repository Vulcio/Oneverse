import { getApiUrl, publicEnvValue } from "./public-env";

/**
 * Where Oneverse's sign-in page (issue #303) sends someone once they're
 * signed in, from the page's query:
 * - the OAuth provider's (an app's sign-in, `client_id` and its signature):
 *   back to the provider, which sends them on to the app;
 * - `return` (an app's sign-in with an invitation's `pass`): that address,
 *   only when it's one of the apps' (SONGVERSE_URL, PLANIVERSE_URL);
 * - else Oneverse's own account page.
 */
export function signInContinuation(search: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(search)) if (typeof value === "string" || typeof value === "number") query.set(name, String(value));
  if (query.has("client_id") && query.has("sig")) {
    // The signature and its expiry are for the sign-in page; the provider gets the request as the app made it.
    for (const name of [...query.keys()]) if (name === "sig" || name === "exp" || name.startsWith("ba_")) query.delete(name);
    return `${getApiUrl()}/api/auth/oauth2/authorize?${query}`;
  }
  const back = query.get("return");
  if (back && isAppAddress(back)) return back;
  return "/account";
}

/** An address in one of the apps that sign in through Oneverse. */
export function isAppAddress(address: string): boolean {
  let origin: string;
  try {
    origin = new URL(address).origin;
  } catch {
    return false;
  }
  return appOrigins().includes(origin);
}

function appOrigins(): string[] {
  return [publicEnvValue("SONGVERSE_URL") ?? "http://localhost:3000", publicEnvValue("PLANIVERSE_URL")].flatMap((address) => {
    try {
      return address ? [new URL(address).origin] : [];
    } catch {
      return [];
    }
  });
}
