import { createFileRoute } from "@tanstack/react-router";
import { OrganizationsPage } from "@oneverse/planning/pages/organizations";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/organizations/")({
  loader: () => apiClient.listMyOrganizations(),
  component: () => <OrganizationsPage data={Route.useLoaderData()} />,
});
