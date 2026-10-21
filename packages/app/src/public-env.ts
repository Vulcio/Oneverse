declare global {
  interface Window {
    __PUBLIC_ENV__?: { apiUrl: string; [name: string]: string | undefined };
  }
}

const DEFAULT_API_URL = "http://localhost:3001";

/**
 * The NestJS API's public URL, needed by browser code (Node's fetch can't
 * resolve a bare path like "/users/me" the way a browser can against its
 * own page URL — it needs the full origin).
 *
 * Deliberately NOT done via Vite's build-time env inlining
 * (import.meta.env.VITE_*): that requires the hosting platform to pass it
 * as a Docker build argument specifically, which turned out to be
 * unreliable to configure correctly. This reads it at runtime instead —
 * the server pulls it from process.env on each boot, and embeds it in the
 * page for the browser to read (see __root.tsx) — so it's just a normal
 * environment variable like everything else.
 */
export function getApiUrl(): string {
  if (typeof window !== "undefined") {
    return window.__PUBLIC_ENV__?.apiUrl ?? DEFAULT_API_URL;
  }
  return process.env.API_URL ?? DEFAULT_API_URL;
}

/**
 * Rendered into a <script> tag in <head> — must run before the app bundle.
 * Server-only: guards against `process` not existing if this ever runs in
 * a browser re-render (Vite's client bundle doesn't define process.env for
 * arbitrary keys the way it does for import.meta.env.VITE_*).
 */
export function renderPublicEnvScript(names: readonly string[] = []): string {
  const env = typeof process !== "undefined" ? process.env : {};
  const values = { apiUrl: env.API_URL ?? DEFAULT_API_URL, ...Object.fromEntries(names.map((name) => [name, env[name]])) };
  // "<" escaped, so no value can close the <script> it's written into (issue #112).
  return `window.__PUBLIC_ENV__=${JSON.stringify(values).replace(/</g, "\\u003c")};`;
}

/**
 * Another of the server's environment variables, also in the browser when
 * the app's root names it in renderPublicEnvScript (Planiverse's
 * SONGVERSE_URL, issue #241). Never a secret: it's in every page.
 */
export function publicEnvValue(name: string): string | undefined {
  if (typeof window !== "undefined") return window.__PUBLIC_ENV__?.[name] || undefined;
  return (typeof process !== "undefined" ? process.env[name] : undefined) || undefined;
}

/**
 * Oneverse's address (issue #303): where people sign in and manage their
 * account. Every app's root names ONEVERSE_URL in renderPublicEnvScript.
 */
export function oneverseUrl(): string {
  return (publicEnvValue("ONEVERSE_URL") ?? "http://localhost:3003").replace(/\/+$/, "");
}
