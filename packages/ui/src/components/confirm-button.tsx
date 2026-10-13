import { useState, type ReactNode } from "react";
import { Button } from "./button";

/**
 * A button for something that can't be undone: the first click asks, and
 * only "confirm" runs `onConfirm`. `busy` is the caller's own "running"
 * flag, shown on the confirm button.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  busyLabel,
  cancelLabel,
  busy = false,
  onConfirm,
}: {
  label: ReactNode;
  confirmLabel: ReactNode;
  busyLabel: ReactNode;
  cancelLabel: ReactNode;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={busy}
        onClick={async () => {
          await onConfirm();
          setConfirming(false);
        }}
      >
        {busy ? busyLabel : confirmLabel}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirming(false)}
        disabled={busy}
      >
        {cancelLabel}
      </Button>
    </div>
  );
}
