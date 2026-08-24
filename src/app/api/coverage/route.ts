import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

// One row per site that has at least one reading, with whether any of its
// readings are flagged. Powers the "N of 60 sites complete" coverage view.
export async function GET() {
  const rows = await db.execute<{ site_id: number; flagged: boolean }>(sql`
    select site_id, bool_or(flagged) as flagged
    from readings
    where site_id is not null
    group by site_id
  `);

  const coverage = rows.map((r) => ({
    siteId: r.site_id,
    hasReading: true,
    flagged: r.flagged,
  }));

  return NextResponse.json(coverage);
}
