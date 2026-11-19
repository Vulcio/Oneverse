import { createFileRoute, redirect } from "@tanstack/react-router";
import { songverseUrl } from "#/lib/planning-host";

/**
 * A set's address here (a notification's email or push about a group that
 * only plans, issue #531): sets open in Songverse, so it goes on there - or
 * to My calendar on a server without Songverse.
 */
export const Route = createFileRoute("/sets/$setlistId")({
  beforeLoad: ({ params }) => {
    const songverse = songverseUrl();
    if (!songverse) throw redirect({ to: "/calendar" });
    throw redirect({ href: `${songverse}/sets/${encodeURIComponent(params.setlistId)}`, reloadDocument: true });
  },
});
