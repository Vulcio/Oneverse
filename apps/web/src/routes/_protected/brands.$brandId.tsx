import { createFileRoute, redirect } from "@tanstack/react-router";
import { BrandEditor } from "#/components/brand-editor";
import { apiClient } from "#/lib/api-client";

/** A brand kit (issue #279): its logos, colours, fonts, backgrounds and links. */
export const Route = createFileRoute("/_protected/brands/$brandId")({
  loader: async ({ params }) => {
    const brand = await apiClient.getBrand(params.brandId).catch(() => null);
    if (!brand) throw redirect({ to: "/screens", search: { tab: "brands" } });
    return { brand };
  },
  component: function Page() {
    const { brand } = Route.useLoaderData();
    // Another brand opened: a fresh editor.
    return <BrandEditor key={brand.id} initial={brand} />;
  },
});
