import { getRequest } from "@tanstack/react-start/server";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, localeFromAcceptLanguage, type LocaleValue } from "@songverse/core";
import { getApiUrl } from "./public-env";

export interface AppSession {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isGlobalAdmin: boolean;
  /** From their roles or their teams' (issue #160): may review songs submitted to the global catalogue (global admins always can). */
  isReviewer: boolean;
  /** May split recordings into stems (global admins always can). */
  canSeparateStems: boolean;
  /** May upload audio files (issue #183); recording in Songverse needs no role. Global admins always can. */
  canUploadAudio: boolean;
  locale: LocaleValue;
  /** Calendars' first day of the week (issue #235): 0 Sunday, 1 Monday, 6 Saturday; null from the language. */
  weekStartsOn: 0 | 1 | 6 | null;
}

interface BetterAuthUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  isGlobalAdmin?: boolean;
  isReviewer?: boolean;
  canSeparateStems?: boolean;
  canUploadAudio?: boolean;
  locale?: string;
  weekStartsOn?: number | null;
}

function asLocale(value: string): LocaleValue {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value) ? (value as LocaleValue) : DEFAULT_LOCALE;
}

/**
 * BetterAuth itself runs in apps/api now (see apps/api/src/auth/) - this
 * forwards the incoming request's session cookie there and reads back
 * `{session, user}` (or null) over HTTP, rather than calling an in-process
 * `auth.api.getSession()` the way this worked when auth lived in this app.
 * `isGlobalAdmin`/`locale` come back on `user` because they're registered
 * as BetterAuth additionalFields (see apps/api's better-auth.ts) - that
 * keeps this to one HTTP round trip instead of a second call to
 * `/users/me` just to get them.
 */
export async function loadSession(): Promise<AppSession | null> {
  const cookie = getRequest().headers.get("cookie");
  const response = await fetch(`${getApiUrl()}/api/auth/get-session`, {
    headers: cookie ? { cookie } : undefined,
  });
  // The auth server failing isn't the same as being signed out: signed out
  // wipes the device's offline copy (Songverse's lib/app-data.ts), a failure mustn't.
  if (response.status >= 500) throw new Error(`The auth server failed (HTTP ${response.status})`);
  if (!response.ok) return null;

  const data = (await response.json()) as { user: BetterAuthUser } | null;
  if (!data?.user) return null;

  return {
    userId: data.user.id,
    email: data.user.email,
    displayName: data.user.name,
    avatarUrl: data.user.image ?? null,
    isGlobalAdmin: Boolean(data.user.isGlobalAdmin),
    isReviewer: Boolean(data.user.isReviewer),
    canSeparateStems: Boolean(data.user.canSeparateStems),
    canUploadAudio: Boolean(data.user.canUploadAudio),
    locale: asLocale(data.user.locale ?? DEFAULT_LOCALE),
    weekStartsOn: data.user.weekStartsOn === 0 || data.user.weekStartsOn === 1 || data.user.weekStartsOn === 6 ? data.user.weekStartsOn : null,
  };
}

/** A signed-out visitor's language, from their browser's Accept-Language. */
export function visitorLocale(): LocaleValue {
  return localeFromAcceptLanguage(getRequest().headers.get("accept-language"));
}

async function mintApiToken(cookie: string): Promise<string | null> {
  const response = await fetch(`${getApiUrl()}/api/auth/token`, { headers: { cookie } });
  // 401 just means there's no valid session.
  if (response.status === 401) return null;
  // Anything else is a real failure; say so rather than returning null and
  // letting the API call go out unauthenticated ("Missing bearer token").
  if (!response.ok) throw new Error(`Couldn't get an API token from the auth server (HTTP ${response.status})`);

  const data = (await response.json()) as { token: string } | null;
  return data?.token ?? null;
}

// One token per incoming request: a server-rendered page makes several API
// calls (layout data, then the page's own), and they can all share it.
const tokensByRequest = new WeakMap<Request, Promise<string | null>>();

/** The current request's API token, one per incoming request. */
export function requestApiToken(): Promise<string | null> {
  const request = getRequest();
  const cookie = request.headers.get("cookie");
  if (!cookie) return Promise.resolve(null);

  let token = tokensByRequest.get(request);
  if (!token) {
    token = mintApiToken(cookie);
    tokensByRequest.set(request, token);
  }
  return token;
}
