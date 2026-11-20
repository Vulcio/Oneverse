import { CalendarDays } from "lucide-react";

/** Oneverse Plan's name and mark (Planiverse until #539), above a signed-out page and in the header. */
export function PlaniverseBrand() {
  return (
    <>
      <CalendarDays className="size-6 text-primary" />
      Oneverse Plan
    </>
  );
}
