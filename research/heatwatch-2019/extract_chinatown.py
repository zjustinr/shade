"""
Cuts the points inside the project's study area out of the CAPA Heat Watch
Boston 2019 shapefiles.

The full dataset (72 MB) is public on OSF but carries no stated licence, so
this repository keeps only the subset inside the area the app covers, and the
means to re-fetch the rest from the source. See README.md.

  python3 research/heatwatch-2019/extract_chinatown.py "All Data_Boston_Heat Watch 2019.zip"

Needs pyshp (pip install pyshp). Writes study-area-points.csv next to itself.
The boxes are the project's own (src/lib/chinatown.ts): STUDY_AREA_BBOX is
what the shade, network and wind data cover, and CHINATOWN_BBOX (SPEC section
5) is the field-campaign area, flagged in the `in_chinatown` column.
"""
import csv
import io
import re
import sys
import tempfile
import zipfile
from pathlib import Path

import shapefile  # pyshp

CHINATOWN = {"west": -71.066, "south": 42.348, "east": -71.055, "north": 42.355}
STUDY_AREA = {"west": -71.0885, "south": 42.3335, "east": -71.0505, "north": 42.3615}
SLOTS = {"Boston_am": "morning", "Boston_pm_revised": "afternoon", "Boston_ev": "evening"}
PREFIX = "All Data_Boston_Heat Watch 2019/"
FIELDS = ["time_n", "lat", "long", "speed", "T_C", "T_F", "RH", "HI_F", "HI_C", "case"]

zip_path = Path(sys.argv[1])
out_path = Path(__file__).with_name("study-area-points.csv")

with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(zip_path) as z:
    rows = []
    for stem, slot in SLOTS.items():
        for ext in ("shp", "shx", "dbf"):
            z.extract(f"{PREFIX}{stem}.{ext}", tmp)
        # The .cpg files name the text encoding unhelpfully ("ANSI 1252").
        reader = shapefile.Reader(str(Path(tmp, PREFIX, stem)), encoding="cp1252")
        names = [f[0] for f in reader.fields[1:]]
        for shape, record in zip(reader.iterShapes(), reader.records()):
            lon, lat = shape.points[0]
            def inside(b):
                return b["west"] <= lon <= b["east"] and b["south"] <= lat <= b["north"]

            if inside(STUDY_AREA):
                row = dict(zip(names, record))
                rows.append({"slot": slot, **{k: row[k] for k in FIELDS}, "in_chinatown": int(inside(CHINATOWN))})

rows.sort(key=lambda r: (r["slot"], r["time_n"]))
with open(out_path, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["slot", *FIELDS, "in_chinatown"])
    writer.writeheader()
    writer.writerows(rows)
print(f"wrote {len(rows)} study-area points to {out_path}")
