# Data sources

Raw files live in `data/raw/` (gitignored). Re-fetch with the scripts named below. See docs/SEED_DATA.md.

## INEC polling units — `data/raw/inec/`

| File | Contents | Fetched | How |
|---|---|---|---|
| `hierarchy.ndjson` | 7 NW states → 186 LGAs → 2,003 wards → **41,671 PUs**: INEC codes + names (+ INEC internal ids) | 2026-09-25 | `node scripts/fetch/inec-pus.ts` |
| `pu-coords.ndjson` | PU coordinates (lat/lng, 4 decimals ≈ 11 m), one row per PU; `lat: null` = INEC returned no coordinate | 2026-09-25 (**partial**, see below) | `node scripts/fetch/inec-pus.ts --coords` |

- **Source:** INEC Polling Unit Locator, https://cvr.inecnigeria.org/pu — the public JSON endpoints its page uses
  (`/PublicApi/{lgas,wards,pus}/1/Search`) and the locator form (`/pu_locator/index`), which redirects to a Google
  Maps link carrying the PU coordinate.
- **Terms:** public information published by INEC. No explicit licence was stated on the page. Used to organise the
  party's own supporter registry on INEC geography; the app does not republish the PU list.
- **Check against PRD §3 (all exact):** Jigawa 17 — 27 / 287 / 4,522 · Kaduna 18 — 23 / 255 / 8,012 · Kano 19 — 44 / 484 / 11,222 ·
  Katsina 20 — 34 / 361 / 6,652 · Kebbi 21 — 21 / 225 / 3,743 · Sokoto 33 — 23 / 244 / 3,991 · Zamfara 36 — 14 / 147 / 3,529
  (LGAs / wards / PUs).
- **Coordinates status (2026-09-25):** 30,406 PUs requested → 26,550 with coordinates, 3,856 returned none.
  11,265 PUs (the rest of Katsina, and Kebbi, Sokoto, Zamfara) not yet requested: INEC began answering **403 Forbidden**
  to this machine after ~30k requests. Resume later (the script is resumable, now one request at a time with a 1.5 s
  pause, and stops on 403): `node scripts/fetch/inec-pus.ts --coords`, then `--coords --retry-missing` once.
  PUs still without coordinates fall back to their ward centroid with `location_estimated = true` (SEED_DATA §1).
- **Registered voters per PU: not needed from INEC.** PU leads report them from the field (PRD US-24, decided 2026-09-25).

## GRID3 boundaries — `data/raw/grid3/`

| File | Layer | Features | Licence | Credit |
|---|---|---|---|---|
| `states.geojson` | GRID3 NGA – Operational State Boundaries (modified 2024-04-30) | 7 | **CC BY 4.0** | eHealth Africa and Proxy Logics. 2020. Nigeria Operational State Boundaries. GRID3. https://grid3.gov.ng/ |
| `lgas.geojson` | GRID3 NGA – Operational LGA Boundaries (modified 2025-09-04) | 186 | **CC BY 4.0** | eHealth Africa and Proxy Logics. 2020. Nigeria Operational LGA Boundaries. GRID3. https://grid3.gov.ng/ |
| `wards.geojson` | GRID3 NGA – Operational Wards **v3.0** (modified 2026-09-22) | 2,004 | **CC BY-SA 4.0** | © 2026 The Trustees of Columbia University in the City of New York (CIESIN), GRID3; funded by the Gates Foundation (INV-044979) |

- **Source:** GRID3 Data Hub (https://data.grid3.org), ArcGIS feature services under
  `services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/`. Fetched 2026-09-25 with
  `node scripts/fetch/grid3-boundaries.ts`. Full licence text and credits per layer are in `*.meta.json`.
- **Share-alike:** the ward layer is CC BY-SA 4.0, so the simplified ward GeoJSON we derive and serve from `public/geo/`
  must be published under CC BY-SA 4.0 with attribution (About page). This applies to the data files, not the app code.
- **Known limitations (from GRID3):** operational, not authoritative boundaries; not fully validated by government;
  spelling/naming inconsistencies expected. 2,004 ward polygons vs INEC's 2,003 wards — to reconcile in the boundary join (task 1.5).

## Evaluated and rejected

- **mykeels/inec-polling-units** (https://github.com/mykeels/inec-polling-units, MIT, last updated 2022-07-15;
  also re-published inside Geoinfotech-Web/ggis-election-webapp). Its PU list is an older copy of INEC's
  (91% of NW PU names still match today's codes), but its coordinates are **Google Places text-search geocodes**
  of the PU name, not INEC points. Checked 2026-09-25 against 20,982 PUs where we hold INEC's own coordinate:
  median error 5.1 km, 38.9% more than 10 km off, p90 82 km. Our ward-centroid estimate (leave-one-out) is better:
  median 2.3 km, 4.6% more than 10 km off. **Not used.** No registered-voter figures in it either.
- **CCIJ 2023 result-sheet archive** (169,353 files): scanned, largely handwritten result sheets. Registered-voter
  counts would need OCR of handwriting and are not the official register. **Not used.**

## Open items

- [ ] Resume PU coordinates after the INEC block lifts (see above). Re-checked 2026-09-25: still 403.
