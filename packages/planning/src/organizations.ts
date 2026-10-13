import type { MyOrganizations } from "@songverse/core";
import { useEffect, useState } from "react";
import { usePlanning } from "./host";

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
  const { api } = usePlanning();
  const [value, setValue] = useState<MyOrganizations | null>(null);
  useEffect(() => {
    let live = true;
    mine ??= api.listMyOrganizations().catch(() => null);
    void mine.then((result) => live && setValue(result));
    return () => {
      live = false;
    };
  }, [api]);
  return value;
}

/** An organisation's groups, each under its parent (depth-first, in the order given), with how deep it sits. */
export function groupTree<T extends { id: string; parentId: string | null }>(groups: T[]): { group: T; depth: number }[] {
  const ids = new Set(groups.map((group) => group.id));
  const out: { group: T; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const group of groups.filter((one) => (one.parentId && ids.has(one.parentId) ? one.parentId : null) === parentId)) {
      out.push({ group, depth });
      visit(group.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

/** A group and every group under it: where it can't go. */
export function withSubgroups(groups: { id: string; parentId: string | null }[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const group of groups) {
      if (group.parentId && out.has(group.parentId) && !out.has(group.id)) {
        out.add(group.id);
        grew = true;
      }
    }
  }
  return out;
}
