import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

/**
 * Nothing here yet, or nothing found (issue #425): what a list, a table or a
 * tab shows in place of its rows. An icon if it helps, a line that says what
 * is missing, and what to do about it.
 *
 * ```tsx
 * <Empty>
 *   <EmptyMedia><ListMusic /></EmptyMedia>
 *   <EmptyTitle>No sets yet</EmptyTitle>
 *   <EmptyDescription>A set is the songs of one service.</EmptyDescription>
 *   <EmptyContent><Button>New set</Button></EmptyContent>
 * </Empty>
 * ```
 *
 * With only words in it, it is one quiet line: `<Empty>No songs yet.</Empty>`.
 */
function Empty({ className, variant = "plain", ...props }: ComponentProps<"div"> & { variant?: "plain" | "card" | "dashed" }) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-balance text-muted-foreground",
        variant === "card" && "rounded-xl border bg-card shadow-sm",
        variant === "dashed" && "rounded-lg border border-dashed",
        className,
      )}
      {...props}
    />
  );
}

function EmptyMedia({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty-media" aria-hidden className={cn("mb-1 flex size-10 items-center justify-center rounded-lg bg-muted text-foreground [&_svg]:size-5", className)} {...props} />;
}

function EmptyTitle({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty-title" className={cn("text-base font-medium text-foreground", className)} {...props} />;
}

function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="empty-description" className={cn("max-w-prose [&_a]:underline [&_a]:underline-offset-4", className)} {...props} />;
}

function EmptyContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty-content" className={cn("mt-2 flex flex-wrap items-center justify-center gap-2", className)} {...props} />;
}

export { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle };
