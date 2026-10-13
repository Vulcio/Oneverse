import { prisma } from "@songverse/db";
import { SIGNUP_PASS_KINDS, type SignupPassKind } from "@songverse/core";
import { getEffectiveSecuritySettings } from "../security/security-settings.js";

/**
 * Sign-up by invitation only (issue #198): who may create an account when
 * Admin > Users says so. Plain functions, not a Nest service: BetterAuth's
 * user-create hook (auth/better-auth.ts) calls them, outside Nest.
 *
 * Let in: an email invited by an admin; or whoever opened a pass - an
 * invitation's link, a team's or an organisation's invite link, a set's share link - which the
 * API kept in a cookie (`PASS_COOKIE`) for the account made next, by email
 * or by Google (whose callback reaches the API with that cookie too).
 */

export const PASS_COOKIE = "songverse_signup_pass";
/** Long enough to sign up, verify the email and come back. */
export const PASS_MAX_AGE_S = 60 * 60;
/** How long an invitation works. */
export const INVITATION_DAYS = 14;

export interface SignupPass {
  kind: SignupPassKind;
  token: string;
}

export function encodePass(pass: SignupPass): string {
  return `${pass.kind}:${pass.token}`;
}

/** The pass in a request's cookies, if it has one. */
export function passFromCookies(cookieHeader: string | null | undefined): SignupPass | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== PASS_COOKIE) continue;
    const value = decodeURIComponent(rest.join("="));
    const at = value.indexOf(":");
    const kind = value.slice(0, at) as SignupPassKind;
    if (at > 0 && SIGNUP_PASS_KINDS.includes(kind)) return { kind, token: value.slice(at + 1) };
  }
  return null;
}

/** Whether a pass still works: the invitation pending, the team link not expired or used up, the set link still there. */
export async function passIsValid(pass: SignupPass, now = new Date()): Promise<boolean> {
  if (pass.kind === "signup") {
    const invitation = await prisma.signupInvitation.findUnique({ where: { token: pass.token }, select: { expiresAt: true, acceptedAt: true } });
    return !!invitation && !invitation.acceptedAt && invitation.expiresAt > now;
  }
  if (pass.kind === "team") {
    const link = await prisma.teamInviteLink.findUnique({ where: { token: pass.token }, select: { expiresAt: true, maxUses: true, usedCount: true } });
    return !!link && (!link.expiresAt || link.expiresAt > now) && (link.maxUses === null || link.usedCount < link.maxUses);
  }
  if (pass.kind === "organization") {
    // An organisation's invite link (issue #241), as a team's.
    const link = await prisma.organizationInviteLink.findUnique({ where: { token: pass.token }, select: { expiresAt: true, maxUses: true, usedCount: true } });
    return !!link && (!link.expiresAt || link.expiresAt > now) && (link.maxUses === null || link.usedCount < link.maxUses);
  }
  return !!(await prisma.setlistShareLink.findUnique({ where: { token: pass.token }, select: { id: true } }));
}

/** A pending invitation for this email. */
async function invited(email: string, now = new Date()): Promise<boolean> {
  const invitation = await prisma.signupInvitation.findUnique({ where: { email: email.toLowerCase() }, select: { expiresAt: true, acceptedAt: true } });
  return !!invitation && !invitation.acceptedAt && invitation.expiresAt > now;
}

/** Whether an account with this email may be created now; always, unless sign-up is by invitation only. */
export async function signupAllowed(email: string, pass: SignupPass | null, alwaysAllowed: (email: string) => boolean): Promise<boolean> {
  if (!(await getEffectiveSecuritySettings()).signupInviteOnly) return true;
  if (alwaysAllowed(email)) return true;
  if (await invited(email)) return true;
  return !!pass && (await passIsValid(pass));
}

/** Once the account exists: the invitation it came from - by its email, or the pass's - is used. */
export async function markInvitationAccepted(email: string, pass: SignupPass | null): Promise<void> {
  const now = new Date();
  await prisma.signupInvitation.updateMany({ where: { email: email.toLowerCase(), acceptedAt: null }, data: { acceptedAt: now } });
  if (pass?.kind === "signup") await prisma.signupInvitation.updateMany({ where: { token: pass.token, acceptedAt: null }, data: { acceptedAt: now } });
}
