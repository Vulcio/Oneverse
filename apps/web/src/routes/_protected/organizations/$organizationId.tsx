import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { loadOrganizationPage } from "@oneverse/planning/loaders";
import { OrganizationPage } from "@oneverse/planning/pages/organization";
import { BibleCard } from "#/components/bible-card";
import { ArchivesCard } from "#/components/archives-card";
import { BrandsCard } from "#/components/brands-card";
import { OwnStorageCard } from "#/components/own-storage-card";
import { ScopedRolesCard } from "#/components/scoped-roles-card";
import { SonicServerCard } from "#/components/sonic-server-card";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/organizations/$organizationId")({
  loader: async ({ context, params }) => {
    const data = await loadOrganizationPage(apiClient, params.organizationId);
    if (!data) throw redirect({ to: "/organizations" });
    return { userId: context.session.userId, data };
  },
  component: function Page() {
    const router = useRouter();
    const { userId, data } = Route.useLoaderData();
    // Its brands (issue #279), its own Sonic server (issue #300) and the Bible in its teams' sidebar (issue #310), for its admins.
    return (
      <OrganizationPage
        userId={userId}
        data={data}
        setupOnPage={{ roles: true, storage: true, sonic: true }}
        adminCards={
          <>
            {/* Its teams' backups (issue #351). */}
            <ArchivesCard owner={{ scope: "organization", id: data.organization.id }} />
            {/* Its teams' songs' files in its own bucket (issue #206). */}
            <OwnStorageCard organizationId={data.organization.id} />
            <BrandsCard owner={{ organizationId: data.organization.id }} />
            <SonicServerCard owner={{ organizationId: data.organization.id }} />
            {/* Roles its admins give its members, on its teams only (issue #270). */}
            <ScopedRolesCard owner={{ organizationId: data.organization.id }} members={data.members} />
            <BibleCard
              enabled={!!data.organization.bible}
              onChange={async (bible) => {
                await apiClient.updateOrganization(data.organization.id, { bible });
                await router.invalidate();
              }}
            />
          </>
        }
      />
    );
  },
});
