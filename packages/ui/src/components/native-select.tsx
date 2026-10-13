import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

/**
 * The browser's own <select>, styled like our inputs - for plain option
 * lists, where a native picker is the best fit on phones. `compact` is
 * the smaller size used inside rows and toolbars.
 */
function NativeSelect({ className, compact = false, ...props }: ComponentProps<"select"> & { compact?: boolean }) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "rounded-md border border-input bg-transparent shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
        compact ? "h-8 px-2 text-xs" : "h-9 px-3 text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
