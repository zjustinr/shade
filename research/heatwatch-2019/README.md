# Heat Watch Boston 2019: the Chinatown subset

An independent, street-level air-temperature record to compare the shade
model against. Kept here as a **small subset with its provenance**, not as a
mirror of the full dataset (see "Terms" below).

## Source

- **Collected by:** volunteers organised by the Museum of Science, Boston
  ("Wicked Hot Boston"), July 29-30, 2019, using CAPA Strategies' Heat Watch
  car-mounted sensors (GPS, temperature and humidity once a second, one-hour
  drives at about 6am, 3pm and 7pm). Programme supported by NOAA and NIHHIS.
- **Published by:** CAPA Strategies on OSF, "Heat Watch Campaigns (2019)":
  https://osf.io/tdsy7/ (Boston, MA folder).
- **File used:** `All Data_Boston_Heat Watch 2019.zip` (72,396,055 bytes),
  https://osf.io/download/f6xyd/
  - SHA-256 `6179398d73a87d714367eadf7cdeffc90259240fe556f8533223ee24d676fd3b`
- **Report:** `Final Report_Heat Watch Boston_100419.pdf`,
  https://osf.io/download/kbsa4/ (SHA-256 `f18f6b40c12253005cf00b5e9c22430f5526656b6f0e953c07a28a26996939c4`).
  It cites Shandas et al. (2019) for the area-wide model and Voelkel and
  Shandas (2017), *Climate* 5(2):41, for the method. The report states
  adjusted R-squared of 0.96-0.98 from a random 70/30 holdout; that figure is
  for the model's own training area and should not be quoted as accuracy at
  Chinatown.
- Retrieved 2026-11-18.

## What is in this folder

| File | What |
|---|---|
| `study-area-points.csv` | The 5,004 sensor points inside the area the app covers (1,785 morning, 1,278 afternoon, 1,941 evening), unchanged from the source shapefiles apart from the added `slot` and `in_chinatown` columns. 262 of them (83 / 100 / 79) are inside the Chinatown box. |
| `extract_chinatown.py` | Cuts that subset from the zip. Needs `pyshp`. |
| `results.md` | Output of `npm run analyze:heatwatch` (afternoon points vs the shade model). |

Fields: `time_n` is the clock time as hhmmss in **UTC** (subtract 4 hours for
Boston; the date is not recorded, only that the campaign ran July 29-30);
`lat`, `long` in WGS84; `speed` (units not stated in the source); `T_C`,
`T_F` air temperature; `RH` relative humidity; `HI_F`, `HI_C` heat index;
`case` (not documented in the source).

Inside Chinatown itself the cars made only a couple of short drive-throughs
per time of day; the wider study area has about ten drives per time of day. The source rasters (modelled temperature and heat index at 10 m) and the
full point files are not copied here; fetch them from OSF with the links and
checksums above.

## Terms

The OSF project is public but states **no licence**. Until CAPA Strategies or
the Museum of Science confirms terms, this repository keeps only the
Chinatown subset needed for the analysis, with full credit, and does not
redistribute the rest. If either organisation asks for it to be removed, remove
it. Contact: `info@capastrategies.com` or the form at
https://www.capastrategies.com/contact-us. Credit CAPA Strategies, the Museum of
Science, Boston, and NOAA/NIHHIS in anything that uses it.

## What the analysis found

See `results.md` (re-run with `npm run analyze:heatwatch`).

- **Pre-specified test, Chinatown box (100 afternoon points, 3 drives):** points
  the model places in shade were *not* cooler in air temperature: +0.46 F,
  two-sided p = 0.09 (wrong direction, not significant).
- **Added later, whole study area (1,278 points, 10 drives):** no difference at
  all: -0.03 F, p = 0.90.

Neither validates nor refutes the shade model. The sensor reads air above a
road, which barely differs between sun and shade, so a null result is what
physics predicts, and it can't distinguish a good shade model from a bad one. The
real test is the crew's paired sidewalk surface readings.
