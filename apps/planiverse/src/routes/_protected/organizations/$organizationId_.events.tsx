import { createFileRoute, redirect } from "@tanstack/react-router";
import { loadOrganizationEventsPage } from "@oneverse/planning/loaders";
import { OrganizationEventsPage } from "@oneverse/planning/pages/organization-events";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/organizations/$organizationId_/events")({
  loader: async ({ params }) => {
    const data = await loadOrganizationEventsPage(apiClient, params.organizationId);
    if (!data) throw redirect({ to: "/organizations" });
    return data;
  },
  component: () => <OrganizationEventsPage data={Route.useLoaderData()} />,
});
