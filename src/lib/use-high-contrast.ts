"use client";

import { useCallback, useEffect } from "react";
import { useLocalStorage } from "@/lib/use-local-storage";

const STORAGE_KEY = "shade:high-contrast";

/** Persisted high-contrast field mode for use in bright sun (§7). */
export function useHighContrast() {
  const [stored, setStored] = useLocalStorage(STORAGE_KEY, "0");
  const enabled = stored === "1";

  // Drive the class on <html> so the `hc:` Tailwind variant applies globally.
  useEffect(() => {
    document.documentElement.classList.toggle("hc", enabled);
  }, [enabled]);

  const toggle = useCallback(() => {
    setStored(enabled ? "0" : "1");
  }, [enabled, setStored]);

  return { enabled, toggle };
}
