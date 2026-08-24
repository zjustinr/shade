import { toCsv } from "@/lib/export";
import { getReadingsWithSites } from "@/lib/readings-query";
import { requireAdminAuth } from "@/lib/require-auth";

export async function GET() {
  const unauthorized = await requireAdminAuth();
  if (unauthorized) return unauthorized;

  const rows = await getReadingsWithSites();
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cool-corners-readings.csv"',
    },
  });
}
