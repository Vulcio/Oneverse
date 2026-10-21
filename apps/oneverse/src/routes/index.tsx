import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "@oneverse/app/server-auth";

/** Signed in, the account; else signing in. */
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    throw redirect({ to: (await getSession()) ? "/account" : "/sign-in" });
  },
});
