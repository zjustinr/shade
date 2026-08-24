import { toGeoJson } from "@/lib/export";
import { getReadingsWithSites } from "@/lib/readings-query";
import { requireAdminAuth } from "@/lib/require-auth";

export async function GET() {
  const unauthorized = await requireAdminAuth();
  if (unauthorized) return unauthorized;

  const rows = await getReadingsWithSites();
  return new Response(JSON.stringify(toGeoJson(rows), null, 2), {
    headers: {
      "Content-Type": "application/geo+json",
      "Content-Disposition": 'attachment; filename="cool-corners-readings.geojson"',
    },
  });
}
