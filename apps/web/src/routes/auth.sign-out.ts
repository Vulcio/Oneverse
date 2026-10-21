import { createFileRoute } from "@tanstack/react-router";
import { signOut } from "@oneverse/app/oauth";

/** Signing out (issue #303): this app's session, then Oneverse's. */
export const Route = createFileRoute("/auth/sign-out")({
  server: { handlers: { GET: ({ request }) => signOut(request) } },
});
