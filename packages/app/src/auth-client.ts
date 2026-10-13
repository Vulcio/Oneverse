import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";
import { getApiUrl } from "./public-env";
// Forces TS to have a portable module specifier for zod's internal "v4/core"
// types (pulled in transitively via the passkey client plugin), avoiding
// TS2742 "inferred type of 'authClient' cannot be named" on the export
// below — same underlying pnpm/zod-v4 friction the old server-side auth.ts
// used to hit (see git history).
import type {} from "zod/v4/core";

/**
 * BetterAuth itself now runs in apps/api (see apps/api/src/auth/), not
 * here - this client talks to it cross-origin. `getApiUrl()` already
 * handles the isomorphic (server/browser) URL resolution used everywhere
 * else in this app; the browser sends the session cookie automatically on
 * same-site requests (see apps/api's `advanced.crossSubDomainCookies`).
 */
export const authClient = createAuthClient({
  baseURL: getApiUrl(),
  plugins: [passkeyClient()],
});
