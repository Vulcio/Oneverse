import { getApiUrl, oneverseUrl } from "./public-env";

/**
 * Sign in with Oneverse (issue #303, docs/sign-in-with-oneverse.md): Songverse
 * and Planiverse are OAuth clients of the API, and people sign in at
 * Oneverse. Each app keeps its own session: its tokens, in a cookie on its
 * own domain, refreshed by its server. Server-only: the handlers of the
 * app's /auth/* routes, and what its session reads.
 *
 * The app's client id is fixed by its build (`__ONEVERSE_CLIENT__`, from its
 * vite.config.ts); its address is read from `addressEnv` (Songverse's WEB_URL,
 * Planiverse's PLANIVERSE_URL), or else the request's.
 */
declare const __ONEVERSE_CLIENT__: { id: string; addressEnv: string } | null;

export interface OAuthClient {
  id: string;
  addressEnv: string;
}

/** This app as an OAuth client, or null in Oneverse itself (which has BetterAuth's own cookie). */
export function oauthClient(): OAuthClient | null {
  return typeof __ONEVERSE_CLIENT__ === "undefined" ? null : __ONEVERSE_CLIENT__;
}

// Named after the app: on one host (localhost, in development) each app's
// cookies are the others' too.
const sessionCookieName = (client: OAuthClient) => `oneverse_session_${client.id}`;
const pendingCookieName = (client: OAuthClient) => `oneverse_sign_in_${client.id}`;
/** As long as a refresh token lasts: 30 days without opening the app signs one out. */
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
/** Long enough to sign in, or up and verify an email. */
const PENDING_MAX_AGE_S = 60 * 60;
/** Refreshed this long before the access token runs out. */
const REFRESH_MARGIN_MS = 2 * 60_000;
const SCOPES = "openid profile email offline_access";

/** What the session cookie holds. */
export interface AppTokens {
  accessToken: string;
  refreshToken: string;
  /** When the access token runs out, in ms. */
  expiresAt: number;
}

interface PendingSignIn {
  state: string;
  verifier: string;
  next: string;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function randomString(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeOf(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decode<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

/** A cookie on the app's own host: httpOnly, Secure on https, sent on top-level navigations from elsewhere (Lax). */
export function cookieHeader(name: string, value: string, maxAgeS: number, secure: boolean): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeS}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** A cookie from a request's Cookie header. */
export function readCookie(cookies: string | null, name: string): string | undefined {
  for (const part of (cookies ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** The app's address: its environment's, or the request's (as the proxy in front of it says). */
export function appOrigin(request: Request, client: OAuthClient): string {
  const configured = process.env[client.addressEnv]?.trim().replace(/\/+$/, "");
  if (configured) return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(configured) ? configured : `https://${configured}`).origin;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return `${proto ?? url.protocol.replace(":", "")}://${host ?? url.host}`;
}

/** A path in this app to go back to: anything else (another site, "//host") is its home. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function requireClient(): OAuthClient {
  const client = oauthClient();
  if (!client) throw new Error("Only an app that signs in through Oneverse has /auth routes.");
  return client;
}

/**
 * GET /auth/sign-in?next=/library: off to Oneverse. With `pass` (an
 * invitation's or an invite link's, issue #198) it goes to Oneverse's
 * sign-in page first, which keeps the pass for signing up, then comes back
 * here without it.
 */
export async function startSignIn(request: Request): Promise<Response> {
  const client = requireClient();
  const url = new URL(request.url);
  const origin = appOrigin(request, client);
  const next = safeNext(url.searchParams.get("next"));
  const secure = origin.startsWith("https:");
  const pass = url.searchParams.get("pass");
  if (pass) {
    const back = `${origin}/auth/sign-in?${new URLSearchParams({ next })}`;
    const signIn = new URLSearchParams({ pass, return: back });
    const email = url.searchParams.get("email");
    if (email) signIn.set("email", email);
    return redirect(`${oneverseUrl()}/sign-in?${signIn}`);
  }
  const pending: PendingSignIn = { state: randomString(), verifier: randomString(), next };
  const authorize = new URLSearchParams({
    response_type: "code",
    client_id: client.id,
    redirect_uri: `${origin}/auth/callback`,
    scope: SCOPES,
    state: pending.state,
    code_challenge: await challengeOf(pending.verifier),
    code_challenge_method: "S256",
    resource: apiResource(),
  });
  return redirect(`${getApiUrl()}/api/auth/oauth2/authorize?${authorize}`, [cookieHeader(pendingCookieName(client), encode(pending), PENDING_MAX_AGE_S, secure)]);
}

/** The API as the tokens' audience: its own address (the API's apiResource()). */
function apiResource(): string {
  return new URL(getApiUrl()).origin;
}

/** GET /auth/callback?code&state: the code for tokens, kept in the app's session cookie. */
export async function finishSignIn(request: Request): Promise<Response> {
  const client = requireClient();
  const url = new URL(request.url);
  const origin = appOrigin(request, client);
  const secure = origin.startsWith("https:");
  const pending = decode<PendingSignIn>(readCookie(request.headers.get("cookie"), pendingCookieName(client)));
  const clearPending = cookieHeader(pendingCookieName(client), "", 0, secure);
  const code = url.searchParams.get("code");
  // Not this browser's sign-in (or it took over an hour): start again.
  if (!pending || !code || url.searchParams.get("state") !== pending.state) {
    return redirect(`${origin}/auth/sign-in?${new URLSearchParams({ next: pending?.next ?? "/" })}`, [clearPending]);
  }
  const tokens = await requestTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${origin}/auth/callback`,
    client_id: client.id,
    code_verifier: pending.verifier,
    resource: apiResource(),
  });
  if (!tokens) return redirect(`${origin}/auth/sign-in?${new URLSearchParams({ next: pending.next })}`, [clearPending]);
  return redirect(`${origin}${pending.next}`, [clearPending, sessionCookie(client, tokens, secure)]);
}

/**
 * GET /auth/sign-out: the app's session ends (its refresh token revoked),
 * then Oneverse's too, which comes back to the app's home.
 */
export async function signOut(request: Request): Promise<Response> {
  const client = requireClient();
  const origin = appOrigin(request, client);
  const tokens = readTokens(request.headers.get("cookie"), client);
  if (tokens) {
    await fetch(`${getApiUrl()}/api/auth/oauth2/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refreshToken, token_type_hint: "refresh_token", client_id: client.id }),
    }).catch(() => undefined);
  }
  return redirect(`${oneverseUrl()}/sign-out?${new URLSearchParams({ return: `${origin}/` })}`, [cookieHeader(sessionCookieName(client), "", 0, origin.startsWith("https:"))]);
}

/** The tokens in a request's cookies, if any. */
export function readTokens(cookies: string | null, client: OAuthClient): AppTokens | null {
  const tokens = decode<AppTokens>(readCookie(cookies, sessionCookieName(client)));
  return tokens && typeof tokens.accessToken === "string" && typeof tokens.refreshToken === "string" ? tokens : null;
}

function sessionCookie(client: OAuthClient, tokens: AppTokens, secure: boolean): string {
  return cookieHeader(sessionCookieName(client), encode(tokens), SESSION_MAX_AGE_S, secure);
}

/** The session cookie as it's set again after a refresh (null: cleared, signed out). */
export function refreshedSessionCookie(client: OAuthClient, tokens: AppTokens | null, secure: boolean): { name: string; value: string; maxAge: number; secure: boolean } {
  return { name: sessionCookieName(client), value: tokens ? encode(tokens) : "", maxAge: tokens ? SESSION_MAX_AGE_S : 0, secure };
}

/** Whether the access token runs out soon. */
export function needsRefresh(tokens: AppTokens, now = Date.now()): boolean {
  return tokens.expiresAt - REFRESH_MARGIN_MS <= now;
}

/** New tokens for a refresh token (a new refresh token each time), or null when it's no longer good. */
export async function refreshTokens(tokens: AppTokens): Promise<AppTokens | null> {
  const client = requireClient();
  return requestTokens({ grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: client.id, resource: apiResource() });
}

async function requestTokens(body: Record<string, string>): Promise<AppTokens | null> {
  const response = await fetch(`${getApiUrl()}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body),
  });
  // Refused (expired, revoked, a banned account's): signed out.
  if (response.status === 400 || response.status === 401) return null;
  if (!response.ok) throw new Error(`The sign-in server failed (HTTP ${response.status})`);
  const data = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token || !data.refresh_token) return null;
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
}
