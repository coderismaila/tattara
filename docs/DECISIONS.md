# Architecture Decision Log

Append new decisions at the bottom. Format: ID · date · status · decision · why · consequences.

### ADR-001 · 2026-09-25 · Accepted · Nuxt 4.5 with compatibilityVersion 5
**Decision:** Build on the latest Nuxt 4.5.x with `future.compatibilityVersion: 5`.
**Why:** Owner preference; the move to Nuxt 5 / Nitro v3 becomes a small step instead of a migration.
**Consequences:** compat 5 is experimental and may break modules. No Nitro auto-imports in `server/`.
Any escape hatch (e.g. `experimental.nitroAutoImports`) must be logged here with a removal condition.

### ADR-002 · 2026-09-25 · Accepted · PU code prefix as the authorisation model
**Decision:** Scope = INEC unit code prefix. One `units` table for all levels.
**Why:** The hierarchy is the geography; prefix checks are simple, indexable and testable.
**Consequences:** Codes must be imported exactly; a unit's code never changes (INEC renames keep codes; relocations get new codes).

### ADR-003 · 2026-09-25 · Accepted · Offline-first with client UUIDv7 + outbox
**Decision:** Dexie outbox, idempotent server upserts by client ID, last-write-wins edits.
**Why:** Field connectivity; one writer per PU means few conflicts.

### ADR-004 · 2026-09-25 · Accepted · Postgres + PostGIS + Drizzle
**Why:** Relational integrity for the hierarchy, spatial checks for GPS flags, typed queries.

### ADR-005 · 2026-09-25 · Accepted · MapLibre + static simplified GeoJSON
**Why:** Free, no per-load fees, works with cached files offline; no basemap by default to save data.

### ADR-006 · 2026-09-25 · Open · Hosting & data residency
Decide with legal counsel (NDPA cross-border rules). Options: Nigerian cloud/colocation vs an international provider with a transfer basis.

### ADR-007 · 2026-09-25 · Open · SMS provider
Default Termii behind an interface; confirm pricing, sender ID approval and delivery rates in NW networks.

### ADR-008 · 2026-09-25 · Accepted · Hausa locale file is JSON5
**Decision:** `i18n/locales/ha.json5` (JSON5) instead of `ha.json`; `en.json` stays plain JSON.
**Why:** CLAUDE.md requires `// TODO(ha-review)` comments on machine-drafted Hausa; JSON has no comments. `@nuxtjs/i18n` loads JSON5 natively.
**Consequences:** Reviewers grep `TODO(ha-review)` in `ha.json5`; remove the marker once a native speaker approves a string.

### ADR-009 · 2026-09-25 · Accepted · Toolchain pins
**Decision:** pnpm pinned via `packageManager: pnpm@10.33.0` (corepack). TypeScript pinned to 6.x.
**Why:** TypeScript 7 (native port) ships without the JS API that `vue-tsc` / `nuxt typecheck` depend on.
**Consequences:** Revisit TS 7 when vue-tsc supports it. No compat-5 escape hatch was needed: all modules load under `compatibilityVersion: 5` (only non-fatal warnings, see PROGRESS notes).
