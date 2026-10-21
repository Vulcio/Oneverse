import { createFileRoute } from "@tanstack/react-router";
import { finishSignIn } from "@oneverse/app/oauth";

/** Back from Oneverse with a code (issue #303): the console's session starts. */
export const Route = createFileRoute("/auth/callback")({
  server: { handlers: { GET: ({ request }) => finishSignIn(request) } },
});
