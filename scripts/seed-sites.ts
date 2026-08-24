import { sql } from "drizzle-orm";
import { db, sites } from "../src/db";
import fixture from "../src/fixtures/sites.json";
import { siteInputSchema } from "../src/lib/validation";

async function main() {
  const rows = fixture.map((row) => siteInputSchema.parse(row));

  for (const row of rows) {
    await db
      .insert(sites)
      .values(row)
      .onConflictDoUpdate({
        target: sites.code,
        set: {
          nameEn: row.nameEn,
          nameZh: row.nameZh,
          nameVi: row.nameVi,
          lat: row.lat,
          lng: row.lng,
          siteType: row.siteType,
          notes: row.notes,
          isControl: row.isControl,
        },
      });
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(sites);
  console.log(`Seeded ${rows.length} sites. Table now has ${count} rows.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
