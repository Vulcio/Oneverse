import { createFileRoute } from "@tanstack/react-router";
import { loadCalendarSection } from "@oneverse/planning/loaders";
import { CalendarSection, calendarTab } from "@oneverse/planning/pages/calendar";
import { apiClient } from "#/lib/api-client";

/**
 * The Calendar section (issue #551): `of` picks the calendar - "me",
 * "team:<id>" or "organization:<id>" - and `tab` what of it is shown.
 */
export const Route = createFileRoute("/_protected/calendar")({
  validateSearch: (search: Record<string, unknown>): { of?: string; tab?: string } => ({
    of: typeof search.of === "string" && search.of !== "me" ? search.of : undefined,
    tab: typeof search.tab === "string" && search.tab !== "dates" ? search.tab : undefined,
  }),
  loaderDeps: ({ search }) => ({ of: search.of }),
  loader: ({ deps }) => loadCalendarSection(apiClient, deps.of),
  component: function Page() {
    const data = Route.useLoaderData();
    const { tab } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <CalendarSection data={data} tab={calendarTab(tab)} onChange={(next) => void navigate({ search: { of: next.of, tab: next.tab } })} />;
  },
});
