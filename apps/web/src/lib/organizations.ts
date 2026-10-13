import type { MyOrganizations } from "@songverse/core";
import { useEffect, useState } from "react";
import { apiClient } from "#/lib/api-client";

let mine: Promise<MyOrganizations | null> | null = null;

/** Asked again next time (after joining, creating or leaving one). */
export function forgetMyOrganizations() {
  mine = null;
}

/**
 * The instance's organisations mode and one's own (issue #241), asked once
 * per page load for the sidebar: null until known, or offline.
 */
export function useMyOrganizations(): MyOrganizations | null {
  const [value, setValue] = useState<MyOrganizations | null>(null);
  useEffect(() => {
    let live = true;
    mine ??= apiClient.listMyOrganizations().catch(() => null);
    void mine.then((result) => live && setValue(result));
    return () => {
      live = false;
    };
  }, []);
  return value;
}
