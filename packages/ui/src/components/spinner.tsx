import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

/**
 * Something is being done (issue #425): in a button while it works, or beside
 * a line that says what is loading. In a button it takes the icon's size and
 * the button's own words say what; alone, give it a `label`.
 */
function Spinner({ className, label, ...props }: Omit<ComponentProps<"svg">, "ref"> & { label?: string }) {
  return <Loader2 data-slot="spinner" role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("size-4 shrink-0 animate-spin", className)} {...props} />;
}

export { Spinner };
