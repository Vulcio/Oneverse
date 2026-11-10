import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

/** A key to press: `<Kbd>Esc</Kbd>`; several together in a `KbdGroup`. */
function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn("pointer-events-none inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-1 rounded border bg-muted px-1.5 font-sans text-[0.7rem] font-medium text-muted-foreground select-none", className)}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="kbd-group" className={cn("inline-flex items-center gap-1", className)} {...props} />;
}

export { Kbd, KbdGroup };
