import { NextResponse } from "next/server";
import { db, isDatabaseConfigured, sites } from "@/db";

export async function GET() {
  // A deployment without a database still serves the public map; the
  // field tool's site list is simply empty rather than a 500 that breaks
  // the offline queue's sync loop.
  if (!isDatabaseConfigured()) return NextResponse.json([]);
  const rows = await db.select().from(sites);
  return NextResponse.json(rows);
}
