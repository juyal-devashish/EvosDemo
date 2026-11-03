"use client";

import { useSyncExternalStore } from "react";

/**
 * False during server render and hydration, true after. Pages whose first
 * client render depends on auth state use it so the server HTML and the
 * hydrating render match.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
