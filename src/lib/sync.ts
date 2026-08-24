import {
  cacheCoverage,
  deleteQueuedReading,
  getPendingReadings,
  updateReadingStatus,
  type QueuedReading,
} from "@/lib/offline-db";

export type SyncResult = { synced: number; failed: number };

/**
 * Uploads every pending/errored queued reading. Never throws — failures are
 * recorded per-reading in IndexedDB so the queue screen can show them.
 * Safe to call repeatedly (regained connectivity, foreground, manual button)
 * because the server upserts on the client-generated id.
 */
export async function syncPendingReadings(): Promise<SyncResult> {
  const pending = await getPendingReadings();
  let synced = 0;
  let failed = 0;

  for (const entry of pending) {
    try {
      await syncOne(entry);
      await deleteQueuedReading(entry.id);
      synced += 1;
    } catch (err) {
      await updateReadingStatus(entry.id, "error", {
        error: err instanceof Error ? err.message : "Sync failed.",
      });
      failed += 1;
    }
  }

  return { synced, failed };
}

async function syncOne(entry: QueuedReading): Promise<void> {
  let photoUrl = entry.photoUrl;

  if (entry.photoBlob && !photoUrl) {
    const form = new FormData();
    form.append("photo", entry.photoBlob, `${entry.id}.jpg`);
    const res = await fetch("/api/photos", { method: "POST", body: form });
    if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
    const data = (await res.json()) as { url: string };
    photoUrl = data.url;
  }

  const res = await fetch("/api/readings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...entry.reading, photoUrl }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Save failed (${res.status})${body ? `: ${body}` : ""}`);
  }

  const saved = (await res.json()) as { siteId: number | null; flagged: boolean };
  if (saved.siteId) {
    await cacheCoverage([{ siteId: saved.siteId, hasReading: true, flagged: saved.flagged }]);
  }
}
