import { createFileRoute, redirect } from "@tanstack/react-router";
import { JoinPage } from "@songverse/app/components/join-page";
import { openInviteLink } from "@songverse/app/join";
import { PlaniverseBrand } from "#/components/brand";
import { apiClient } from "#/lib/api-client";

/** A team's invite link: joined once signed in (see JoinPage). */
export const Route = createFileRoute("/join/$token")({
  beforeLoad: async ({ params }) => {
    const opened = await openInviteLink(apiClient, () => apiClient.joinTeamByToken(params.token));
    if ("joined" in opened) throw redirect({ to: "/teams/$teamId", params: { teamId: opened.joined.id } });
    return opened;
  },
  component: function Page() {
    return <JoinPage kind="team" token={Route.useParams().token} brand={<PlaniverseBrand />} context={Route.useRouteContext()} home={{ href: "/calendar", label: "auth.goToCalendar" }} />;
  },
});
