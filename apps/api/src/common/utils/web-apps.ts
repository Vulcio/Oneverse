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

/** Every web app's origin, Songverse's first. */
export function webOrigins(): string[] {
  const planiverse = planiverseUrl();
  return [new URL(songverseUrl()).origin, ...(planiverse ? [new URL(planiverse).origin] : [])];
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
