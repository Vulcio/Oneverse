declare global {
  interface Window {
    __PUBLIC_ENV__?: { apiUrl: string };
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
export function renderPublicEnvScript(): string {
  const apiUrl = typeof process !== "undefined" ? (process.env.API_URL ?? DEFAULT_API_URL) : DEFAULT_API_URL;
  // "<" escaped, so no value can close the <script> it's written into (issue #112).
  return `window.__PUBLIC_ENV__=${JSON.stringify({ apiUrl }).replace(/</g, "\\u003c")};`;
}
