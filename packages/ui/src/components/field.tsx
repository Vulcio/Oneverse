import type { ComponentProps } from "react";
import { cn } from "../lib/utils";
import { Label } from "./label";

/**
 * One thing to fill in (issue #425): its label, the control, a line of help
 * and its error, spaced the same everywhere.
 *
 * ```tsx
 * <Field>
 *   <FieldLabel htmlFor="name">Name</FieldLabel>
 *   <Input id="name" aria-describedby="name-help" aria-invalid={!!error} />
 *   <FieldDescription id="name-help">As it appears to your team.</FieldDescription>
 *   <FieldError>{error}</FieldError>
 * </Field>
 * ```
 *
 * `orientation="horizontal"` puts the control beside its label (a switch, a
 * checkbox, a short select). Several fields go in a `FieldGroup`.
 */
function Field({ className, orientation = "vertical", ...props }: ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" }) {
  return (
    <div
      data-slot="field"
      data-orientation={orientation}
      className={cn("group/field flex min-w-0 gap-2", orientation === "vertical" ? "flex-col" : "flex-row flex-wrap items-center justify-between gap-x-4", className)}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field-group" className={cn("flex min-w-0 flex-col gap-4", className)} {...props} />;
}

function FieldLabel({ className, ...props }: ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" className={className} {...props} />;
}

function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="field-description" className={cn("text-sm text-muted-foreground [&_a]:underline [&_a]:underline-offset-4", className)} {...props} />;
}

/**
 * What went wrong, under the field or the form it is about: announced as soon
 * as it shows, and nothing at all (no empty gap) while there is no error.
 */
function FieldError({ className, children, size = "default", ...props }: ComponentProps<"p"> & { size?: "default" | "sm" }) {
  if (children == null || children === false || children === "") return null;
  return (
    <p data-slot="field-error" role="alert" className={cn("text-destructive", size === "sm" ? "text-xs" : "text-sm", className)} {...props}>
      {children}
    </p>
  );
}

export { Field, FieldDescription, FieldError, FieldGroup, FieldLabel };
