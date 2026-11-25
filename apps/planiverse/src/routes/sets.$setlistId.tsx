import { oneverseUrl } from "@oneverse/app/public-env";
import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * A set's address here (a notification's email or push about a group that
 * only plans, issue #531): a set opens as its running order in the Oneverse
 * app (issue #521), with or without Songverse.
 */
export const Route = createFileRoute("/sets/$setlistId")({
  beforeLoad: ({ params }) => {
    throw redirect({ href: `${oneverseUrl()}/sets/${encodeURIComponent(params.setlistId)}`, reloadDocument: true });
  },
});
