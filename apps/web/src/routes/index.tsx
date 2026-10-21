import { createFileRoute, redirect } from "@tanstack/react-router";
import { loadAppData } from "#/lib/app-data";
import { forgetOffline } from "#/lib/offline-db";

/**
 * The way in: signed in, the library; signed out, Oneverse's sign-in (issue
 * #303), coming back to `next` - once nothing of the last person's is left
 * on the device (issue #49), when it's the browser that finds them signed out.
 */
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  beforeLoad: async ({ search }) => {
    // Through the app data, which offline falls back to the session kept on the device.
    const session = (await loadAppData())?.session;
    if (session) {
      throw redirect({ to: "/library" });
    }
    if (typeof window !== "undefined") await forgetOffline();
    throw redirect({ href: `/auth/sign-in?${new URLSearchParams({ next: search.next ?? "/library" })}`, reloadDocument: true });
  },
});
