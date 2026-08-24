"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getAllQueuedReadings, type QueuedReading } from "@/lib/offline-db";
import { syncPendingReadings } from "@/lib/sync";
import { useOnlineStatus } from "@/lib/use-pending-count";

export default function QueuePage() {
  const [entries, setEntries] = useState<QueuedReading[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const online = useOnlineStatus();

  const refresh = useCallback(() => {
    getAllQueuedReadings()
      .then(setEntries)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("shade:queue-changed", refresh);
    return () => window.removeEventListener("shade:queue-changed", refresh);
  }, [refresh]);

  async function handleSync() {
    setSyncing(true);
    setResult(null);
    const { synced, failed } = await syncPendingReadings();
    setResult(
      failed > 0
        ? `Uploaded ${synced}. ${failed} still waiting — see the errors below.`
        : synced > 0
          ? `Uploaded ${synced} reading${synced === 1 ? "" : "s"}.`
          : "Nothing waiting to upload.",
    );
    setSyncing(false);
    refresh();
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-4">
      <Link href="/field" className="inline-flex min-h-[44px] items-center text-base underline">
        ← All sites
      </Link>
      <h1 className="mt-2 mb-4 text-2xl font-bold">Waiting to upload</h1>

      {!online ? (
        <p className="mb-4 rounded-lg bg-neutral-100 p-3 hc:bg-black hc:border hc:border-yellow-400">
          You&apos;re offline. Readings are saved on this phone and will upload by themselves
          when you get signal.
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleSync}
        disabled={syncing || !online}
        className="mb-4 h-14 w-full rounded-xl bg-neutral-900 text-lg font-bold text-white disabled:bg-neutral-300 disabled:text-neutral-600 hc:bg-yellow-400 hc:text-black"
      >
        {syncing ? "Uploading…" : "Upload now"}
      </button>

      {result ? (
        <p aria-live="polite" className="mb-4 rounded-lg bg-neutral-100 p-3 hc:bg-black hc:border hc:border-yellow-400">
          {result}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-neutral-600 hc:text-yellow-200">
          Everything has uploaded. Nothing waiting.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-lg border border-neutral-200 p-3 hc:border-yellow-400"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">
                  {entry.reading.sunTempF}°F sun / {entry.reading.shadeTempF}°F shade
                </p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-sm font-medium ${
                    entry.status === "error"
                      ? "bg-red-100 text-red-800"
                      : "bg-neutral-200 text-neutral-700"
                  }`}
                >
                  {entry.status === "error" ? "Failed" : "Waiting"}
                </span>
              </div>
              <p className="text-sm text-neutral-600 hc:text-yellow-200">
                {new Date(entry.reading.recordedAt).toLocaleString()} · {entry.reading.observer}
                {entry.photoBlob ? " · has photo" : ""}
              </p>
              {entry.error ? (
                <p className="mt-1 text-sm text-red-700 hc:text-yellow-300">{entry.error}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
