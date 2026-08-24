"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
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

function subscribeToConnectivity(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOnlineStatus() {
  return useSyncExternalStore(
    subscribeToConnectivity,
    () => navigator.onLine,
    // Assume online during SSR; the client corrects it on hydration.
    () => true,
  );
}
