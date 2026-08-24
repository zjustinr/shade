"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "shade:high-contrast";

export function useHighContrast() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) === "1";
    setEnabled(stored);
    document.documentElement.classList.toggle("hc", stored);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      document.documentElement.classList.toggle("hc", next);
      return next;
    });
  }, []);

  return { enabled, toggle };
}
