import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ReadingInput } from "@/lib/validation";

export type QueuedReadingStatus = "pending" | "syncing" | "synced" | "error";

export interface QueuedReading {
  id: string; // matches ReadingInput.id — the primary key, client-generated
  reading: ReadingInput;
  photoBlob: Blob | null;
  photoUrl: string | null; // set once the photo has been uploaded
  status: QueuedReadingStatus;
  error: string | null;
  queuedAt: string;
}

export interface CachedSite {
  id: number;
  code: string;
  nameEn: string;
  nameZh: string | null;
  nameVi: string | null;
  lat: number;
  lng: number;
  siteType: string;
  isControl: boolean;
}

export interface SiteCoverage {
  siteId: number;
  hasReading: boolean;
  flagged: boolean;
}

interface ShadeFieldDB extends DBSchema {
  readings: {
    key: string;
    value: QueuedReading;
    indexes: { "by-status": QueuedReadingStatus };
  };
  sites: {
    key: number;
    value: CachedSite;
  };
  coverage: {
    key: number; // siteId
    value: SiteCoverage;
  };
}

const DB_NAME = "shade-field";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ShadeFieldDB>> | null = null;

function getDb() {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this environment.");
  }
  if (!dbPromise) {
    dbPromise = openDB<ShadeFieldDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const readingStore = db.createObjectStore("readings", { keyPath: "id" });
        readingStore.createIndex("by-status", "status");
        db.createObjectStore("sites", { keyPath: "id" });
        db.createObjectStore("coverage", { keyPath: "siteId" });
      },
    });
  }
  return dbPromise;
}

function notifyQueueChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("shade:queue-changed"));
  }
}

export async function queueReading(entry: QueuedReading): Promise<void> {
  const db = await getDb();
  await db.put("readings", entry);
  notifyQueueChanged();
}

export async function getAllQueuedReadings(): Promise<QueuedReading[]> {
  const db = await getDb();
  return db.getAll("readings");
}

export async function getPendingReadings(): Promise<QueuedReading[]> {
  const db = await getDb();
  const pending = await db.getAllFromIndex("readings", "by-status", "pending");
  const errored = await db.getAllFromIndex("readings", "by-status", "error");
  return [...pending, ...errored];
}

export async function getPendingCount(): Promise<number> {
  const pending = await getPendingReadings();
  return pending.length;
}

export async function updateReadingStatus(
  id: string,
  status: QueuedReadingStatus,
  patch: Partial<Pick<QueuedReading, "error" | "photoUrl">> = {},
): Promise<void> {
  const db = await getDb();
  const existing = await db.get("readings", id);
  if (!existing) return;
  await db.put("readings", { ...existing, status, error: patch.error ?? null, ...patch });
  notifyQueueChanged();
}

export async function deleteQueuedReading(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("readings", id);
  notifyQueueChanged();
}

export async function cacheSites(sites: CachedSite[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("sites", "readwrite");
  await Promise.all(sites.map((s) => tx.store.put(s)));
  await tx.done;
}

export async function getCachedSites(): Promise<CachedSite[]> {
  const db = await getDb();
  return db.getAll("sites");
}

export async function cacheCoverage(coverage: SiteCoverage[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("coverage", "readwrite");
  await Promise.all(coverage.map((c) => tx.store.put(c)));
  await tx.done;
}

export async function getCachedCoverage(): Promise<SiteCoverage[]> {
  const db = await getDb();
  return db.getAll("coverage");
}
