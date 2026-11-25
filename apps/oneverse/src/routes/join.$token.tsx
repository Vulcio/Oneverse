import { createFileRoute, redirect } from "@tanstack/react-router";
import { JoinPage } from "@oneverse/app/components/join-page";
import { loadLocale } from "@oneverse/app/i18n";
import { getSession } from "@oneverse/app/server-auth";
import { OneverseBrand } from "#/components/brand";
import { apiClient } from "#/lib/api-client";

/**
 * A team's invite link, or an invitation by email (issue #550), opened in
 * Oneverse: joined once signed in, the team's page here; signed out, to
 * Oneverse's own sign-in (the link lets them sign up even by invitation
 * only), and back.
 */
export const Route = createFileRoute("/join/$token")({
  beforeLoad: async ({ params }) => {
    const session = await getSession();
    if (!session) throw redirect({ href: `/sign-in?${new URLSearchParams({ return: `/join/${params.token}`, pass: `team:${params.token}` })}`, reloadDocument: true });
    let joined: { id: string };
    try {
      joined = await apiClient.joinTeamByToken(params.token);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), locale: await loadLocale(session.locale) };
    }
    throw redirect({ to: "/teams/$teamId", params: { teamId: joined.id } });
  },
  component: function Page() {
    return <JoinPage kind="team" brand={<OneverseBrand />} context={Route.useRouteContext()} home={{ href: "/", label: "hub.goHome" }} />;
  },
});
