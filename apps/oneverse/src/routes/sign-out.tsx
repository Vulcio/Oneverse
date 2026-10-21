import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { authClient } from "@oneverse/app/auth-client";
import { isAppAddress } from "@oneverse/app/sign-in-continuation";

/**
 * Signing out of Oneverse (issue #303): an app sends people here once its
 * own session has ended, with `return`, its home - only an app's address.
 */
export const Route = createFileRoute("/sign-out")({
  validateSearch: (search: Record<string, unknown>) => ({
    return: typeof search.return === "string" ? search.return : undefined,
  }),
  component: SignOutPage,
});

function SignOutPage() {
  const back = Route.useSearch().return;
  useEffect(() => {
    void authClient.signOut().finally(() => {
      window.location.replace(back && isAppAddress(back) ? back : "/sign-in");
    });
  }, [back]);
  return null;
}
