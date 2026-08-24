import { desc, eq } from "drizzle-orm";
import { db, readings, sites } from "@/db";
import type { ReadingWithSite } from "@/lib/export";

export async function getReadingsWithSites(): Promise<ReadingWithSite[]> {
  const rows = await db
    .select({ reading: readings, site: sites })
    .from(readings)
    .leftJoin(sites, eq(readings.siteId, sites.id))
    .orderBy(desc(readings.recordedAt));
  return rows;
}
