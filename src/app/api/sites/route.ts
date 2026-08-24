import { NextResponse } from "next/server";
import { db, sites } from "@/db";

export async function GET() {
  const rows = await db.select().from(sites);
  return NextResponse.json(rows);
}
