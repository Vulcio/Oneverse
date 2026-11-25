import { createFileRoute } from "@tanstack/react-router";
import { RunningOrderPage } from "@oneverse/planning/pages/running-order";

/** A set's running order (issue #521): where Plan, the home and a date's page open a set. */
export const Route = createFileRoute("/_protected/sets/$setlistId")({
  component: RunningOrder,
});

function RunningOrder() {
  const { setlistId } = Route.useParams();
  return <RunningOrderPage key={setlistId} setlistId={setlistId} />;
}
