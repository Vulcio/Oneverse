import { Share } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { shareLink, useCanShareLink, type SharedLink } from "../lib/share";
import { Button } from "./button";

/**
 * Share a link through the device's own share sheet (issue #407): Messages,
 * WhatsApp, Mail… Shown only where the browser has one; "Copy link" beside it
 * stays for the others.
 */
export function ShareButton({ link, label, ...props }: { link: SharedLink | null; label: ReactNode } & Omit<ComponentProps<typeof Button>, "onClick" | "children">) {
  const can = useCanShareLink();
  if (!can || !link) return null;
  return (
    <Button type="button" variant="outline" data-testid="share-button" {...props} onClick={() => void shareLink(link)}>
      <Share />
      {label}
    </Button>
  );
}
