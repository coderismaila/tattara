# Seed Data — INEC geography & boundaries

The app is only as good as its geography. Getting all 41,671 NW polling units in cleanly is task #1 after scaffolding.

## 1. Sources (the human obtains these; Claude writes the importers)

| Dataset | Source | Format | Notes |
|---|---|---|---|
| States, LGAs, wards, PUs with codes and names | INEC (inecnigeria.org polling unit directory / PU locator; INEC may provide a CSV on request) | PDF / CSV / JSON | Codes are `SS/LL/WW/PPP`. PDFs need parsing. |
| PU coordinates | INEC GIS data (INEC geolocated all 176,846 PUs) | CSV/GeoJSON if obtainable | If unavailable, fall back to ward centroid and flag `location_estimated`. |
| Registered voters per PU | INEC 2023 register figures | CSV | If PU-level is missing, use ward-level totals for coverage. |
| State/LGA/ward boundaries | GRID3 Nigeria operational boundaries | GeoJSON/Shapefile | Check the licence and attribute it in the app's About page. |

Put raw files in `data/raw/` (gitignored). Record each file's origin and date in `data/SOURCES.md`.

## 2. Canonical intermediate format

The importers first normalise everything to `data/normalised/units.csv`:

```
code,level,parent_code,name,registered_voters,lat,lng,source_version
19,state,,KANO,,,,inec-2023-01
19/05,lga,19,<LGA NAME>,,,,inec-2023-01
19/05/03,ward,19/05,<WARD NAME>,,,,inec-2023-01
19/05/03/012,pu,19/05/03,<PU NAME>,812,12.0012,8.5123,inec-2023-01
```

Rules:
- Zero-pad: state 2, LGA 2, ward 2, PU 3 digits.
- Upper-case names as published; generate `name_normalised`.
- Parent must exist; no orphans.

## 3. Validation checks (script fails loudly)

Implemented by `pnpm db:seed` (`scripts/import-inec-pus.ts` → `scripts/import/inec.ts`). Errors stop the import; warnings are printed.
Optional inputs are picked up when present: `data/raw/inec/pu-coords.ndjson`, `data/raw/inec/registered-voters.csv` (`code,registered_voters`, PU level), `data/raw/grid3/states.geojson`.
PUs without a usable coordinate get the centroid of known PU points in their ward (then LGA, then state) with `location_estimated = true`.
Flags: `--dry-run` (diff only), `--csv-only`, `--source-version <v>`.

1. Counts per state match expectations (see the PRD table): print a diff table, and do not fail on mismatch; ask the human to confirm.
2. No duplicate codes; every PU's parent chain resolves to one of the 7 NW state codes.
3. PU coordinates fall inside **their own state's** bounding box (from the GRID3 state polygons, +0.05° margin; fallback NW box lat 9.0–14.0, lng 3.4–10.7 — Jigawa reaches lng 10.61, so the old lng ≤ 10.5 was too tight) and ideally inside their ward polygon (PostGIS `ST_Within`, task 1.5); outliers are reported and replaced by an estimate.
4. `registered_voters` non-negative; ward sum sanity check.

## 4. Boundary join
`scripts/import-grid3-boundaries.ts`:
1. Load GRID3 layers, filter to the 7 states.
2. Match to our units by normalised name within parent (state → LGA → ward), using Jaro-Winkler similarity ≥ 0.92.
3. Write unmatched pairs to `data/crosswalk/unmatched.csv`; the human fills `data/crosswalk/manual.csv` (`grid3_id,code`).
4. Simplify with mapshaper (`-simplify 3% keep-shapes`), set `code` property, write to `public/geo/`.
5. Report file sizes; target states < 150 KB, LGAs < 600 KB, each state's wards < 800 KB.

## 5. Dev seed
`scripts/seed-dev.ts` creates:
- A fake mini-geography if real data is absent: 2 states × 3 LGAs × 4 wards × 10 PUs, codes in the real format.
- Users for every role with PIN `123456` (dev only; guarded by `NODE_ENV !== 'production'`).
- 5,000 fake supporters with faker (Hausa-like names list in `scripts/fixtures/names.ts`), some deliberately flag-worthy.

## 6. Refresh
INEC occasionally changes PUs. The `/admin/import/units` endpoint runs the same normaliser with a **dry-run diff** (added / renamed / deactivated) before applying. Units are never hard-deleted: they're set `active=false`, and supporters keep their pu_code.
