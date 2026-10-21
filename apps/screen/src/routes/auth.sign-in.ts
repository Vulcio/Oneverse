import { createFileRoute } from "@tanstack/react-router";
import { startSignIn } from "@oneverse/app/oauth";

/** Signing in, through Oneverse (issue #303): `?next=` is where to come back to. */
export const Route = createFileRoute("/auth/sign-in")({
  server: { handlers: { GET: ({ request }) => startSignIn(request) } },
});
