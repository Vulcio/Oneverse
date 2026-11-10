import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

/**
 * The shape of what is coming, while it loads (issue #425): give it the size
 * of the line, picture or row it stands for. For a list or a card whose
 * layout is known; a short wait in a button is a `Spinner`.
 */
function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
