import { loadLocale } from "./i18n";
import { getSession, getVisitorLocale } from "./server-auth";
import type { createAppApiClient } from "./api-client";

type Api = ReturnType<typeof createAppApiClient>;

/** What an invite link's page shows: signing in or up first, or why joining didn't work. */
export interface JoinPageContext {
  error: string | null;
  hasGoogleAuth: boolean;
  signupInviteOnly: boolean;
  locale: Awaited<ReturnType<typeof loadLocale>>;
}

/**
 * An invite link opened (a team's or an organisation's, issue #242: the
 * same in both apps). Signed in, it joins with `join` and gives what was
 * joined, for the route to go to; signed out, what the sign-in card needs.
 */
export async function openInviteLink(api: Api, join: () => Promise<{ id: string }>): Promise<{ joined: { id: string } } | JoinPageContext> {
  const session = await getSession();
  if (!session) {
    const [{ hasGoogleAuth, signupInviteOnly }, locale] = await Promise.all([api.getAuthPublicConfig(), getVisitorLocale()]);
    return { error: null, hasGoogleAuth, signupInviteOnly, locale: await loadLocale(locale) };
  }
  try {
    return { joined: await join() };
  } catch (error) {
    // Signed in already: the sign-in card isn't shown, its settings don't matter.
    return { error: error instanceof Error ? error.message : String(error), hasGoogleAuth: false, signupInviteOnly: false, locale: await loadLocale(session.locale) };
  }
}
