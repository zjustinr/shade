"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGE_EVENT = "shade:local-storage";

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * Reads a localStorage value as an external store. Using
 * useSyncExternalStore rather than an effect keeps the server snapshot
 * explicit and avoids a cascading render on mount.
 */
export function useLocalStorage(key: string, fallback: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(key) ?? fallback,
    () => fallback,
  );

  const setValue = useCallback(
    (next: string) => {
      window.localStorage.setItem(key, next);
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    },
    [key],
  );

  return [value, setValue] as const;
}
