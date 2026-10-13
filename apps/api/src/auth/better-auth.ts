import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { jwt } from "better-auth/plugins/jwt";
import { customSession } from "better-auth/plugins/custom-session";
import { passkey } from "@better-auth/passkey";
import { prisma } from "@songverse/db";
import { getEffectiveAuthSettings, type EffectiveAuthSettings } from "./auth-settings.js";
import { webOrigins } from "../common/utils/web-apps.js";
import { passkeyRpId, sharedCookieDomain } from "./auth-domains.js";
import { capabilitiesOf } from "../roles/capabilities.js";
import { markInvitationAccepted, passFromCookies, signupAllowed } from "../invitations/signup-gate.js";
import {
  sendChangeEmailConfirmation,
  sendNewEmailVerification,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./email.js";

// Comma-separated list of emails that should be promoted to global admin
// the moment they sign up — there's no other bootstrap path (no "first
// user" logic), so without this every account is an ordinary user until
// someone hand-edits the database.
const bootstrapAdminEmails = new Set(
  (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

// AUTH_URL is this API's own public URL (it's where BetterAuth is
// mounted - see main.ts). WEB_URL is the *browser-facing* app's public
// URL: needed separately because WebAuthn ties a passkey to the origin
// the browser was actually on when registering it (the web app), not to
// wherever the auth server happens to live, and because verification/
// reset-password links redirect back into the web app, which - now that
// it's a different origin from AUTH_URL - has to be explicitly trusted.
// PLANIVERSE_URL, when set, is the second web app's (issue #241): trusted
// the same way, and under the same parent domain (see web-apps.ts).
const authUrl = new URL(process.env.AUTH_URL ?? "http://localhost:3001");
const webOriginList = webOrigins();
const webHostnames = webOriginList.map((origin) => new URL(origin).hostname);

const cookieDomain = sharedCookieDomain(authUrl.hostname, ...webHostnames);

/**
 * BetterAuth issues sessions (cookie-based, shared with the web app via
 * cross-subdomain cookies - see `advanced.crossSubDomainCookies` below)
 * and JWTs (also for the web app, which forwards them as Bearer tokens
 * when calling this API's other endpoints - see JwtAuthGuard).
 *
 * The Prisma User model keeps Songverse's own column names (displayName,
 * avatarUrl) rather than BetterAuth's defaults (name, image) — `user.fields`
 * maps BetterAuth's expected field names onto ours instead of renaming the
 * domain schema. `isGlobalAdmin`/`locale` are registered as additionalFields
 * with `input: false` so BetterAuth's own update-user endpoint rejects any
 * attempt to set them directly (privilege escalation guard) - they're only
 * ever written via the databaseHooks bootstrap logic below, or via this
 * API's own `/users/me` endpoint (see UsersService). Returning them here
 * means the web app's session/get-session call carries everything it needs
 * in one round trip, without a second call back to `/users/me`.
 */
function buildAuth(settings: EffectiveAuthSettings) {
  return betterAuth({
    baseURL: authUrl.origin,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: webOriginList,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    advanced: {
      // See sharedCookieDomain above.
      crossSubDomainCookies: cookieDomain ? { enabled: true, domain: cookieDomain } : { enabled: false },
    },
    emailAndPassword: {
      enabled: true,
      // A session is only created once the address is verified - see
      // sendOnSignUp below and the auth-card "check your email" state.
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail(user.email, url);
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        // Also the second step of an email change (user.email is then the
        // new address), which only a verified account can reach.
        await (user.emailVerified ? sendNewEmailVerification(user.email, url) : sendVerificationEmail(user.email, url));
      },
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      // Deliberately no sendOnSignIn: resending on every failed sign-in
      // attempt from an unverified account would let anyone burn through the
      // Resend quota just by repeatedly submitting the sign-in form. The UI
      // instead offers an explicit "Resend verification email" action, which
      // hits the rate-limited /send-verification-email endpoint below.
    },
    // Google sign-in is opt-in: the button only appears (see
    // apps/web's auth-card.tsx, fed by GET /auth/public-config) once
    // either this or the GOOGLE_CLIENT_ID/SECRET env vars are set via
    // Admin > Auth. Leaving both unset keeps email+password (and
    // passkeys) as the only sign-in methods.
    socialProviders:
      settings.googleClientId && settings.googleClientSecret
        ? { google: { clientId: settings.googleClientId, clientSecret: settings.googleClientSecret } }
        : undefined,
    // Keeps the low-volume Resend free tier from being exhausted by a script
    // hammering the endpoints that actually send email (or repeatedly
    // re-registering accounts).
    rateLimit: {
      customRules: {
        "/request-password-reset": { window: 600, max: 3 },
        "/send-verification-email": { window: 600, max: 3 },
        "/sign-up/email": { window: 600, max: 5 },
        "/change-email": { window: 600, max: 3 },
        // Only read the session the cookie already proves, and are called
        // by the web app's server on every user's behalf - so they'd all
        // share that server's one per-IP bucket, and a few quick page
        // changes by anyone would lock everyone out ("Missing bearer
        // token"). Guessing a session token isn't feasible either way.
        "/get-session": false,
        "/token": false,
      },
    },
    user: {
      fields: {
        name: "displayName",
        image: "avatarUrl",
      },
      // Approve from the current address first, then verify the new one.
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          await sendChangeEmailConfirmation(user.email, newEmail, url);
        },
      },
      additionalFields: {
        isGlobalAdmin: { type: "boolean", input: false, defaultValue: false },
        locale: { type: "string", input: false, defaultValue: "en" },
        // Calendars' first day of the week (issue #235); null from the language.
        weekStartsOn: { type: "number", input: false, required: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Every way of signing in (password, passkey, Google, the
          // auto-sign-in after email verification) creates a session, so
          // this is the one place to turn banned and deleted accounts away.
          // JwtAuthGuard re-checks for tokens issued before a ban.
          before: async (session) => {
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: { bannedAt: true, banReason: true, deletedAt: true },
            });
            if (!user || user.deletedAt) {
              throw APIError.from("FORBIDDEN", { message: "This account no longer exists.", code: "ACCOUNT_DELETED" });
            }
            if (user.bannedAt) {
              throw APIError.from("FORBIDDEN", {
                message: user.banReason
                  ? `Your account has been suspended: ${user.banReason}`
                  : "Your account has been suspended.",
                code: "ACCOUNT_BANNED",
              });
            }
          },
        },
      },
      user: {
        create: {
          // Sign-up by invitation only (issue #198): every way of making an
          // account (email, Google) creates the user here. The bootstrap
          // admins can always sign up, so a fresh server can't lock itself out.
          before: async (user, ctx) => {
            const pass = passFromCookies(cookiesOf(ctx));
            if (await signupAllowed(user.email, pass, (email) => bootstrapAdminEmails.has(email.toLowerCase()))) return;
            // Not FORBIDDEN: BetterAuth answers a 403 here with its generic
            // "check your email" (meant for an existing address), so the
            // person would wait for an email that never comes.
            throw APIError.from("UNPROCESSABLE_ENTITY", {
              message: "Sign-up is by invitation only. Ask an admin of this server, or someone in your team, for an invitation.",
              code: "SIGNUP_INVITE_ONLY",
            });
          },
          // isGlobalAdmin isn't settable through BetterAuth's own create/
          // update input (input: false above) - this writes it directly
          // via Prisma after the row exists, the one legitimate way in.
          after: async (user, ctx) => {
            if (bootstrapAdminEmails.has(user.email.toLowerCase())) {
              await prisma.user.update({ where: { id: user.id }, data: { isGlobalAdmin: true } });
            }
            await markInvitationAccepted(user.email, passFromCookies(cookiesOf(ctx)));
          },
        },
      },
    },
    plugins: [
      jwt({
        jwt: {
          // Base user fields only — guards re-derive isGlobalAdmin and other
          // authorization state from Postgres by `sub` rather than trusting
          // token claims (see JwtAuthGuard).
          definePayload: ({ user }) => ({ email: user.email }),
        },
      }),
      // What their roles allow them (issue #160), with the session: the web
      // app shows what they can use, and the docs what's relevant to them,
      // without asking again. Worked out fresh each time, never stored.
      customSession(async ({ user, session }) => {
        const capabilities = await capabilitiesOf(prisma, user.id);
        return {
          user: {
            ...user,
            isReviewer: capabilities.canReview,
            canSeparateStems: capabilities.canSeparateStems,
            // Audio files (issue #183): a role's, or a global admin's.
            canUploadAudio: capabilities.canUploadAudio || (user as { isGlobalAdmin?: boolean }).isGlobalAdmin === true,
            permissions: capabilities.permissions,
          },
          session,
        };
      }),
      passkey({
        // Tied to the web apps' origins, not this API's - see the comment
        // on AUTH_URL above - under the parent domain, so passkeys survive
        // a web app moving between subdomains and work in both apps (see
        // passkeyRpId).
        rpID: passkeyRpId(authUrl.hostname, ...webHostnames),
        rpName: "Songverse",
        origin: webOriginList,
      }),
    ],
  });
}

/** The cookies of the request a hook runs in (none outside a request). */
function cookiesOf(ctx: { headers?: Headers; request?: Request } | null | undefined): string | null {
  return ctx?.headers?.get("cookie") ?? ctx?.request?.headers.get("cookie") ?? null;
}

type Auth = ReturnType<typeof buildAuth>;

let cachedAuth: Auth | undefined;
// The AuthSettings row's updatedAt, as of the build that produced
// cachedAuth - `undefined` means "never built yet", distinct from `null`
// ("built once, from no row at all"). Comparing this on every call is what
// lets an admin's save (which bumps updatedAt via @updatedAt) take effect
// without a restart, in this and every other process, at the cost of one
// cheap indexed lookup per call - see auth-settings.ts's own note on why
// that lookup isn't itself cached.
let cachedUpdatedAtMs: number | null | undefined;

/**
 * Returns the current BetterAuth instance, rebuilding it only when the
 * admin-managed settings (Admin > Auth) have actually changed since the
 * last build.
 */
export async function getAuth(): Promise<Auth> {
  const settings = await getEffectiveAuthSettings();
  const updatedAtMs = settings.updatedAt?.getTime() ?? null;
  if (cachedAuth === undefined || updatedAtMs !== cachedUpdatedAtMs) {
    cachedAuth = buildAuth(settings);
    cachedUpdatedAtMs = updatedAtMs;
  }
  return cachedAuth;
}
