/**
 * The web apps' public addresses (issue #241): Songverse's (WEB_URL), and
 * Planiverse's (PLANIVERSE_URL) once it's deployed. The API trusts both for
 * sign-in and CORS, and sends each person's notification links to the app
 * they're about. Without PLANIVERSE_URL, everything goes to Songverse.
 */
export function songverseUrl(): string {
  return webAddress("WEB_URL") ?? "http://localhost:3000";
}

export function planiverseUrl(): string | null {
  return webAddress("PLANIVERSE_URL");
}

/**
 * Oneverse's (ONEVERSE_URL, issue #303): where people sign in, and the
 * account's pages. Set, the apps sign in through it (Sign in with Oneverse)
 * and may live on domains of their own; unset, everyone signs in in the
 * apps, under one parent domain, as before.
 */
export function oneverseUrl(): string | null {
  return webAddress("ONEVERSE_URL");
}

/**
 * The screen app's (SCREEN_URL, issue #305): what big screens open
 * (screen.oneverse.top). Its pages call the API with a screen's token, so
 * it's let in like the other apps.
 */
export function screenUrl(): string | null {
  return webAddress("SCREEN_URL");
}

/** Every web app's origin, Songverse's first. */
export function webOrigins(): string[] {
  return [songverseUrl(), planiverseUrl(), oneverseUrl(), screenUrl()].flatMap((address) => (address ? [new URL(address).origin] : []));
}

/**
 * An address from the environment, without its trailing slash: one given
 * without its scheme ("plan.songverse.one") is taken as https; one that
 * still isn't an address stops the API with the variable's name, rather
 * than a bare "Invalid URL".
 */
function webAddress(name: string): string | null {
  const value = process.env[name]?.trim().replace(/\/+$/, "");
  if (!value) return null;
  const address = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(address).origin === "null" ? fail() : address;
  } catch {
    return fail();
  }
  function fail(): never {
    throw new Error(`${name} must be a web address, like https://app.example.com (it's "${value}")`);
  }
}
