import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-1 rounded-lg border px-3 py-2.5 text-sm has-[>svg]:grid-cols-[1rem_1fr] has-[>svg]:gap-x-2.5 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive: "border-destructive/40 bg-destructive/5 [&>svg]:text-destructive *:data-[slot=alert-title]:text-destructive",
        warning: "border-warning/40 bg-warning/10 [&>svg]:text-warning",
        success: "border-success/40 bg-success/10 [&>svg]:text-success",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

/**
 * A notice in the page (issue #425): something to know before going on, that
 * stays as long as it is true. An icon first if there is one, then
 * `AlertTitle`, `AlertDescription`, and `AlertAction` for what to do about it.
 *
 * `destructive` is announced at once (`role="alert"`); the others when the
 * reader gets there (`role="status"`). A form's own error is a `FieldError`,
 * and "saved" is a toast.
 */
function Alert({ className, variant, role, ...props }: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role={role ?? (variant === "destructive" ? "alert" : "status")} className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-title" className={cn("col-start-2 min-w-0 font-medium", className)} {...props} />;
}

function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("col-start-2 flex min-w-0 flex-col gap-1 text-muted-foreground [&_a]:underline [&_a]:underline-offset-4", className)} {...props} />;
}

function AlertAction({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-action" className={cn("col-start-2 mt-1 flex flex-wrap items-center gap-2", className)} {...props} />;
}

export { Alert, AlertAction, AlertDescription, AlertTitle, alertVariants };
