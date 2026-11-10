import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        outline: "border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/**
 * A button - or, with `render`, another element that looks like one (a
 * router `<Link render={<Link to=… />}>`), as Base UI composes (issue #144).
 *
 * Its `title` shows as a tooltip (issue #425), on hover and on keyboard
 * focus, in the app's look rather than the browser's: what an icon button
 * does, said the same way everywhere. It names the button too, unless an
 * `aria-label` does. A disabled button keeps the browser's own title: it
 * takes no pointer or focus events for a tooltip to open on, and its title
 * is where it says why it can't be used.
 */
function Button({ className, variant, size, render, title, ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { render?: useRender.RenderProp }) {
  const tooltip = title && !props.disabled ? title : undefined;
  const button = useRender({
    defaultTagName: "button",
    render,
    props: {
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...(tooltip ? (!props["aria-label"] && size === "icon" ? { "aria-label": tooltip } : null) : { title }),
      ...props,
    },
  });
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger delay={400} render={button} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export { Button, buttonVariants };
