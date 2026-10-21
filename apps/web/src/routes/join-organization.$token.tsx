import { createFileRoute, redirect } from "@tanstack/react-router";
import { JoinPage } from "@oneverse/app/components/join-page";
import { openInviteLink } from "@oneverse/app/join";
import { SongverseBrand } from "#/components/brand";
import { apiClient } from "#/lib/api-client";

/** An organisation's invite link (issue #241): joined once signed in (see JoinPage). */
export const Route = createFileRoute("/join-organization/$token")({
  beforeLoad: async ({ params }) => {
    const opened = await openInviteLink({ kind: "organization", token: params.token }, () => apiClient.joinOrganizationByToken(params.token));
    if ("joined" in opened) throw redirect({ to: "/organizations/$organizationId", params: { organizationId: opened.joined.id } });
    return opened;
  },
  component: function Page() {
    return <JoinPage kind="organization" brand={<SongverseBrand />} context={Route.useRouteContext()} home={{ href: "/dashboard", label: "auth.goToDashboard" }} />;
  },
});
