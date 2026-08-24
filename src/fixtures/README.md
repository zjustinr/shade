# Fixtures

## `sites.json`

This ships with **8 placeholder sites plus 2 control points**, not the real
60-location survey list called for in SPEC §1/§4. Real site selection
requires walking Chinatown with the crew and picking actual bus stops,
senior-housing entrances, playgrounds, crosswalks, plazas, parks, schools,
and other high-exposure pedestrian locations — that's fieldwork this build
can't fabricate. Coordinates below are illustrative points inside the
Chinatown bounding box (`-71.066, 42.348` to `-71.055, 42.355`) from SPEC §5,
not verified real-world locations.

Before the field campaign:

1. Replace every row in `sites.json` with a real site: accurate `lat`/`lng`,
   a real `nameEn` (and `nameZh`/`nameVi` once translated), and the correct
   `siteType`.
2. Keep 2+ `isControl: true` rows for the Boston Common comparison points
   (§4), with confirmed coordinates.
3. Run `npm run seed:sites` to upsert the fixture into the database (matches
   on the unique `code`, so re-running after edits is safe).
