import { createFileRoute } from "@tanstack/react-router";
import { EventDatePage } from "@oneverse/planning/pages/event-date";

/** One event date's page (issue #575): the same in Plan, Songverse and Oneverse's home. */
export const Route = createFileRoute("/_protected/events/$eventId/$date")({
  component: EventDate,
});

function EventDate() {
  const { eventId, date } = Route.useParams();
  return <EventDatePage key={`${eventId}/${date}`} eventId={eventId} date={date} />;
}
