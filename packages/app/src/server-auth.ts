import { createServerFn } from "@tanstack/react-start";
import { loadSession, requestApiToken, visitorLocale } from "./session";

// Only server functions here, their work in ./session: a plain function
// beside a createServerFn can end up in the browser's bundle (CLAUDE.md).
export type { AppSession } from "./session";

/** Returns the current session, or null when signed out. Safe to call anywhere. */
export const getSession = createServerFn({ method: "GET" }).handler(loadSession);

/** A signed-out visitor's language, from their browser's Accept-Language. */
export const getVisitorLocale = createServerFn({ method: "GET" }).handler(visitorLocale);

/** Mints a short-lived JWT for the current session, for calling the NestJS API. */
export const getApiToken = createServerFn({ method: "GET" }).handler(requestApiToken);
