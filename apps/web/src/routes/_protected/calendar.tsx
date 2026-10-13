import { createFileRoute } from "@tanstack/react-router";
import { MyCalendarPage } from "@songverse/planning/pages/my-calendar";

export const Route = createFileRoute("/_protected/calendar")({
  component: MyCalendarPage,
});
