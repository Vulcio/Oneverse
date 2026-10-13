import "../zod-config.js";
import { z } from "zod";
import { optional } from "./fields.js";

/** Sign-up by invitation only (issue #198): where an invitation to create an account can come from. */
export const SIGNUP_PASS_KINDS = ["signup", "team", "set", "organization"] as const;
export type SignupPassKind = (typeof SIGNUP_PASS_KINDS)[number];

/** POST /admin/invitations: invites an email to sign up (again, for one already invited: a new link). */
export const CreateSignupInvitationSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  send: optional(z.boolean()).describe("Email the link (default true)"),
});
export type CreateSignupInvitationRequest = z.input<typeof CreateSignupInvitationSchema>;

/**
 * POST /auth/invite-pass: someone signed out opening an invitation, a team's
 * invite link or a set's share link - the API keeps it in a cookie, so the
 * account they then create (by email or Google) is let in.
 */
export const SignupPassSchema = z.strictObject({
  kind: z.enum(SIGNUP_PASS_KINDS),
  token: z.string().min(1).max(200),
});
export type SignupPassRequest = z.input<typeof SignupPassSchema>;
