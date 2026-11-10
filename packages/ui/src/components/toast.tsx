import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";

/**
 * Short confirmations that go away on their own (issue #425): "Saved",
 * "Link copied", "Couldn't save" with a way to try again. Base UI's Toast,
 * one manager for the whole app so anything can say something:
 *
 * ```tsx
 * toast("Link copied");
 * toast.success("Saved");
 * toast.error("Couldn't save", { description: message, action: { label: "Try again", onClick: save } });
 * ```
 *
 * An app shows them by putting `<Toaster />` once in its root. What must stay
 * until it is dealt with is an `Alert` in the page, not a toast.
 */
const manager = ToastPrimitive.createToastManager();

interface ToastOptions {
  description?: ReactNode;
  /** A button in the toast: undo, try again, open it. */
  action?: { label: string; onClick: () => void };
  /** How long it stays, in ms (5 s; an error 8 s). 0 keeps it until closed. */
  timeout?: number;
  /** A toast with the same id replaces the one showing. */
  id?: string;
}

type ToastKind = "default" | "success" | "error";

function show(kind: ToastKind, title: ReactNode, { description, action, timeout, id }: ToastOptions = {}): string {
  return manager.add({
    id,
    title,
    description,
    type: kind,
    timeout: timeout ?? (kind === "error" ? 8000 : 5000),
    priority: kind === "error" ? "high" : "low",
    actionProps: action ? { children: action.label, onClick: action.onClick } : undefined,
  });
}

/** Say something for a few seconds. Returns its id, for `toast.dismiss(id)`. */
const toast = Object.assign((title: ReactNode, options?: ToastOptions) => show("default", title, options), {
  success: (title: ReactNode, options?: ToastOptions) => show("success", title, options),
  error: (title: ReactNode, options?: ToastOptions) => show("error", title, options),
  dismiss: (id?: string) => manager.close(id),
});

function ToastList({ closeLabel }: { closeLabel: string }) {
  const { toasts } = ToastPrimitive.useToastManager();
  return toasts.map((item) => (
    <ToastPrimitive.Root
      key={item.id}
      toast={item}
      data-slot="toast"
      data-kind={item.type}
      className={cn(
        "pointer-events-auto relative w-full rounded-lg border bg-popover text-popover-foreground shadow-lg select-none",
        "transition-[opacity,transform] duration-200 data-ending-style:opacity-0 data-limited:hidden data-starting-style:translate-y-2 data-starting-style:opacity-0",
        "[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--toast-swipe-movement-y))]",
      )}
    >
      <ToastPrimitive.Content className="flex items-start gap-2.5 p-3">
        {item.type === "success" ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : null}
        {item.type === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ToastPrimitive.Title data-slot="toast-title" className="text-sm font-medium" />
          <ToastPrimitive.Description data-slot="toast-description" className="text-sm text-muted-foreground" />
        </div>
        {item.actionProps ? (
          <ToastPrimitive.Action data-slot="toast-action" className="inline-flex h-7 shrink-0 items-center rounded-md border bg-background px-2.5 text-xs font-medium outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
        ) : null}
        <ToastPrimitive.Close
          aria-label={closeLabel}
          data-slot="toast-close"
          className="-m-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="size-4" aria-hidden />
        </ToastPrimitive.Close>
      </ToastPrimitive.Content>
    </ToastPrimitive.Root>
  ));
}

/** Where the toasts show: bottom right on a wide screen, across the bottom of a phone. Once per app. */
function Toaster({ closeLabel = "Close", className }: { closeLabel?: string; className?: string }) {
  return (
    <ToastPrimitive.Provider toastManager={manager} limit={4}>
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport
          data-slot="toaster"
          className={cn("pointer-events-none fixed right-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 z-[100] flex flex-col-reverse gap-2 sm:left-auto sm:w-[22rem]", className)}
        >
          <ToastList closeLabel={closeLabel} />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}

export { Toaster, toast, type ToastOptions };
