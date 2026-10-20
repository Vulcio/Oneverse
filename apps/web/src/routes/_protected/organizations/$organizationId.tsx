import { createFileRoute, redirect } from "@tanstack/react-router";
import { loadOrganizationPage, OrganizationPage } from "@songverse/planning/pages/organization";
import { BrandsCard } from "#/components/brands-card";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/organizations/$organizationId")({
  loader: async ({ context, params }) => {
    const data = await loadOrganizationPage(apiClient, params.organizationId);
    if (!data) throw redirect({ to: "/organizations" });
    return { userId: context.session.userId, data };
  },
  component: function Page() {
    const { userId, data } = Route.useLoaderData();
    // Its brands (issue #279), for its admins.
    return <OrganizationPage userId={userId} data={data} adminCards={<BrandsCard owner={{ organizationId: data.organization.id }} />} />;
  },
});
