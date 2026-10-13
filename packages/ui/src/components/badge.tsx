import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

const VARIANTS = {
  default: "bg-primary/10 text-primary",
  muted: "bg-muted text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  outline: "border text-muted-foreground",
} as const;

function Badge({ className, variant = "default", ...props }: ComponentProps<"span"> & { variant?: keyof typeof VARIANTS }) {
  return (
    <span
      data-slot="badge"
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", VARIANTS[variant], className)}
      {...props}
    />
  );
}

export { Badge };
