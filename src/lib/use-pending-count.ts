"use client";

import { useEffect, useState } from "react";
import { getPendingCount } from "@/lib/offline-db";

export function usePendingCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getPendingCount()
        .then((n) => {
          if (!cancelled) setCount(n);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener("shade:queue-changed", refresh);
    const interval = window.setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      window.removeEventListener("shade:queue-changed", refresh);
      window.clearInterval(interval);
    };
  }, []);

  return count;
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return online;
}
