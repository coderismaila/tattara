# Boundary data: sources and licences

These GeoJSON files are simplified derivatives of GRID3 Nigeria operational boundaries, re-keyed to INEC unit
codes (`code` property) by `pnpm geo:build` (scripts/import-grid3-boundaries.ts). They are operational, not
authoritative, boundaries.

| File | Derived from | Licence |
|---|---|---|
| `nw-states.geojson` | GRID3 NGA – Operational State Boundaries. eHealth Africa and Proxy Logics. 2020. Nigeria Operational State Boundaries. Geo-Referenced Infrastructure and Demographic Data for Development (GRID3). https://grid3.gov.ng/ | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `nw-lgas.geojson` | GRID3 NGA – Operational LGA Boundaries. eHealth Africa and Proxy Logics. 2020. Nigeria Operational Local Government Area (LGA) Boundaries. GRID3. https://grid3.gov.ng/ | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `wards/*.geojson` | GRID3 NGA – Operational Wards v3.0. © 2026 The Trustees of Columbia University in the City of New York (CIESIN), GRID3; funded by the Gates Foundation (INV-044979). https://data.grid3.org/ | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

Changes made: filtered to the 7 North West states; matched to INEC states/LGAs/wards and given INEC codes and
names; features dissolved by code; geometry simplified (mapshaper, 3%, keep-shapes; coordinates rounded to 0.0001°).

**Share-alike:** the ward files are adapted material under CC BY-SA 4.0 and are distributed under the same licence.
This applies to these data files only, not to the application code. The app's About page must show this attribution.
