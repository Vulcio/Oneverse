import { createFileRoute, redirect } from "@tanstack/react-router";
import { loadOrganizationPage, OrganizationPage } from "@oneverse/planning/pages/organization";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/organizations/$organizationId")({
  loader: async ({ context, params }) => {
    const data = await loadOrganizationPage(apiClient, params.organizationId);
    if (!data) throw redirect({ to: "/organizations" });
    return { userId: context.session.userId, data };
  },
  component: function Page() {
    const { userId, data } = Route.useLoaderData();
    return <OrganizationPage userId={userId} data={data} />;
  },
});
