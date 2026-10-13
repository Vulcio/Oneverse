import { CalendarDays } from "lucide-react";

/** Planiverse's name and mark, above a signed-out page and in the header. */
export function PlaniverseBrand() {
  return (
    <>
      <CalendarDays className="size-6 text-primary" />
      Planiverse
    </>
  );
}
