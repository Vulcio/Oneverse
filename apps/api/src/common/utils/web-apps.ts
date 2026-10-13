/**
 * The web apps' public addresses (issue #241): Songverse's (WEB_URL), and
 * Planiverse's (PLANIVERSE_URL) once it's deployed. The API trusts both for
 * sign-in and CORS, and sends each person's notification links to the app
 * they're about. Without PLANIVERSE_URL, everything goes to Songverse.
 */
export function songverseUrl(): string {
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function planiverseUrl(): string | null {
  return process.env.PLANIVERSE_URL?.trim().replace(/\/+$/, "") || null;
}

/** Every web app's origin, Songverse's first. */
export function webOrigins(): string[] {
  const planiverse = planiverseUrl();
  return [new URL(songverseUrl()).origin, ...(planiverse ? [new URL(planiverse).origin] : [])];
}
