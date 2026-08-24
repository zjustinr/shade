/**
 * Seeds the two Cooling Corners (SPEC §12 milestone 8).
 *
 * The fixture ships placeholders: the installations do not exist yet, and
 * /corners says so plainly until they do. Replace the rows with the real
 * thing once built, then re-run — matching is on name_en, so editing a
 * description and re-running updates rather than duplicating.
 */
import { eq } from "drizzle-orm";
import { db, coolingCorners } from "../src/db";
import fixture from "../src/fixtures/cooling-corners.json";

async function main() {
  for (const row of fixture) {
    const existing = await db
      .select({ id: coolingCorners.id })
      .from(coolingCorners)
      .where(eq(coolingCorners.nameEn, row.nameEn));

    if (existing.length > 0) {
      await db.update(coolingCorners).set(row).where(eq(coolingCorners.id, existing[0].id));
    } else {
      await db.insert(coolingCorners).values(row);
    }
  }

  const all = await db.select().from(coolingCorners);
  console.log(`Seeded ${fixture.length} cooling corners. Table now has ${all.length} rows.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
