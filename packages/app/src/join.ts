import { redirect } from "@tanstack/react-router";
import type { SignupPassKind } from "@oneverse/core";
import { loadLocale } from "./i18n";
import { getSession } from "./server-auth";

/** What an invite link's page shows: why joining didn't work. */
export interface JoinPageContext {
  error: string;
  locale: Awaited<ReturnType<typeof loadLocale>>;
}

/**
 * Off to sign in at Oneverse (issue #303), and back to `next`. With an
 * invitation's or a link's `pass` (issue #198), Oneverse lets them sign up
 * even by invitation only; `email` fills in an invited address.
 */
export function signInFirst(next: string, pass?: { kind: SignupPassKind; token: string }, email?: string) {
  const query = new URLSearchParams({ next });
  if (pass) query.set("pass", `${pass.kind}:${pass.token}`);
  if (email) query.set("email", email);
  return redirect({ href: `/auth/sign-in?${query}`, reloadDocument: true });
}

const INVITE_PATHS = { team: "/join/", organization: "/join-organization/" } as const;

/**
 * An invite link opened (a team's or an organisation's, issue #242: the
 * same in both apps). Signed in, it joins with `join` and gives what was
 * joined, for the route to go to; signed out, off to sign in or up first
 * (the link lets them sign up even by invitation only), and back here.
 */
export async function openInviteLink(invite: { kind: "team" | "organization"; token: string }, join: () => Promise<{ id: string }>): Promise<{ joined: { id: string } } | JoinPageContext> {
  const session = await getSession();
  if (!session) throw signInFirst(`${INVITE_PATHS[invite.kind]}${invite.token}`, invite);
  try {
    return { joined: await join() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), locale: await loadLocale(session.locale) };
  }
}
