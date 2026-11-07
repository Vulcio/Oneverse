import { useEffect, useState } from "react";

/** What to share: a page's address, with its title (and a line of text where the target shows one). */
export interface SharedLink {
  title: string;
  url: string;
  text?: string;
}

/** The device's own share sheet (issue #407, Web Share) can take this link: iPhone, iPad, Android, macOS Safari, Chrome and Edge on Windows. */
export function canShareLink(link?: SharedLink): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  return !link || typeof navigator.canShare !== "function" || navigator.canShare(link);
}

/**
 * Whether to offer Share: false while the page is drawn on the server and
 * until it's hydrated, so the button doesn't appear in a page that then
 * disagrees with the server's.
 */
export function useCanShareLink(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => setCan(canShareLink()), []);
  return can;
}

/** Opens the share sheet; false when it couldn't (cancelled, or not offered here). */
export async function shareLink(link: SharedLink): Promise<boolean> {
  if (!canShareLink(link)) return false;
  try {
    await navigator.share(link);
    return true;
  } catch {
    // Closed without sharing (AbortError), or refused.
    return false;
  }
}
