import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

/**
 * Buttons side by side as one control (shadcn's ButtonGroup). `chevron`
 * cuts them into steps pointing on to the next - a progression read left
 * to right - the page's background showing through as the joins between
 * them; give its buttons a fill (secondary, muted...), not a border.
 */
const buttonGroupVariants = cva("flex w-fit items-stretch", {
  variants: {
    variant: {
      default:
        "[&>*]:focus-visible:relative [&>*]:focus-visible:z-10 [&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none",
      chevron: [
        "isolate [&>*]:rounded-none [&>*]:focus-visible:z-10",
        // Each step's point, and the notch the next one's point sits in, a little apart.
        "[&>*:not(:last-child)]:pr-[calc(var(--step-padding,0.75rem)+0.625rem)] [&>*:not(:first-child)]:-ml-1 [&>*:not(:first-child)]:pl-[calc(var(--step-padding,0.75rem)+0.625rem)]",
        "[&>*:first-child:not(:last-child)]:[clip-path:polygon(0_0,calc(100%-0.625rem)_0,100%_50%,calc(100%-0.625rem)_100%,0_100%)]",
        "[&>*:not(:first-child):not(:last-child)]:[clip-path:polygon(0_0,calc(100%-0.625rem)_0,100%_50%,calc(100%-0.625rem)_100%,0_100%,0.625rem_50%)]",
        "[&>*:last-child:not(:first-child)]:[clip-path:polygon(0_0,100%_0,100%_100%,0_100%,0.625rem_50%)]",
        "[&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md",
        // The flat ends: more room before the first and after the last, as a button has.
        "[&>*:first-child]:pl-[calc(var(--step-padding,0.75rem)+0.5rem)] [&>*:last-child]:pr-[calc(var(--step-padding,0.75rem)+0.5rem)]",
      ].join(" "),
    },
  },
  defaultVariants: { variant: "default" },
});

function ButtonGroup({ className, variant, ...props }: ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return <div role="group" data-slot="button-group" data-variant={variant ?? "default"} className={cn(buttonGroupVariants({ variant }), className)} {...props} />;
}

export { ButtonGroup, buttonGroupVariants };
