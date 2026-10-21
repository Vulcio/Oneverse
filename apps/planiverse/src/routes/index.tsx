import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "@oneverse/app/server-auth";

/** The way in (issue #303): signed in, the calendar; signed out, Oneverse's sign-in, coming back to `next`. */
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  beforeLoad: async ({ search }) => {
    if (await getSession()) throw redirect({ to: "/calendar" });
    throw redirect({ href: `/auth/sign-in?${new URLSearchParams({ next: search.next ?? "/calendar" })}`, reloadDocument: true });
  },
});
