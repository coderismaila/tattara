# Progress Log

Newest at the top. One line per completed task: `YYYY-MM-DD · task id · summary · commit`.
Also note blockers and anything the next session must know.

## Blockers / notes for next session
- Toolchain: Node 24 (nvm-windows) + pnpm via corepack (`corepack enable pnpm`). TypeScript stays on 6.x (ADR-009).
- Compat-5 warnings (non-fatal, all modules already at latest): `unplugin-vue-i18n:resource`,
  `nuxt-fonts-public-assets` and devtools have Vite hooks ignored under the environment API. Verified harmless:
  both locales load, and Noto Sans loads in the production build (e2e `shell.spec.ts` checks ɓ ɗ ƙ ƴ).
- Shell: nav items live in `app/utils/nav.ts`; add each page there when it lands. App pages set
  `definePageMeta({ layout: 'app', titleKey })`. Every new page should be added to the axe loop in `test/e2e/shell.spec.ts`.
- Lighthouse accessibility on the prod build (0.5): `/` 100, `/app` 100, `/app/settings` 100.
- CI workflow (`.github/workflows/ci.yml`) has not run on GitHub yet: no remote. All its steps pass locally
  (frozen install, lint, typecheck, test, build, e2e). Push to GitHub to confirm the AC "CI green".
- `pnpm install` still prints an "Ignored build scripts" notice for unrs-resolver/vue-demi despite
  `pnpm-workspace.yaml`; harmless (neither needs its script).
- Build warns that Nitro's `runtime/utils/cache-driver.mjs` can't be resolved. **6.1:** verify cached handlers
  (60 s stats cache) actually cache in a production build.
- PWA is a minimal generateSW placeholder (manifest + sw.js build fine); 4.1 replaces it with injectManifest.
- DB: `pnpm db:up && pnpm db:migrate`. Integration tests (`pnpm test:integration`) need the DB; they skip locally
  without it and fail in CI. `pg_trgm` is enabled by migration 0007 (3.4).
- **1.3 data (see `data/SOURCES.md`):** fetched by `pnpm data:fetch:inec` / `data:fetch:grid3`.
  - Done: INEC hierarchy, 41,671 PUs (all 7 states match PRD counts exactly); GRID3 states (7), LGAs (186), wards v3.0 (2,004).
  - **PU coordinates partial:** 26,550 found, 3,856 returned none, 11,265 not yet asked. INEC started answering
    **403** to this machine after ~30k requests (two fetch instances ran at once by mistake). Wait before resuming:
    `pnpm data:fetch:inec-coords` (now 1 req / 1.5 s, lock file, stops on 403), then once with `--retry-missing`.
  - **Registered voters per PU: collected by PU leads in the field** (decided 2026-09-25; PRD US-24, task 3.7).
    The importer never overwrites a stored figure with NULL, so re-imports are safe once leads start reporting.
  - **Follow-up (non-blocking):** remaining PU coordinates — INEC still 403 on 2026-09-25. Resume from another
    network or later; then `pnpm geo:build && pnpm db:seed`.
  - **After fetching more data, re-run `pnpm geo:build` then `pnpm db:seed`** (use `--dry-run` first to see the diff).
    Both are idempotent. geo:build gives the importer `boundary_ref` + ward polygon points (location fallback).
- **1.5 boundaries:** 7/7 states, 186/186 LGAs (2 via `data/crosswalk/manual.csv`), 1,986/2,003 wards.
  - **👤 17 wards unresolved** in `data/crosswalk/unmatched.csv` (with candidate GRID3 wards and scores); 19 accepted
    matches flagged in `data/crosswalk/review.csv`. Resolve by adding `grid3_id,code,note` rows to `manual.csv`.
  - Kebbi/Sokoto/Zamfara wards match on names only until their PU coordinates are fetched.
  - Every unit now has a location (all 43,867); 2,657 INEC PU points lie outside their matched ward polygon (report).
  - **About page (UI task):** must show the attribution in `public/geo/ATTRIBUTION.md` (wards are CC BY-SA 4.0).
  - 6.3 map: files are `public/geo/nw-states.geojson` (9 KB), `nw-lgas.geojson` (75 KB), `wards/{state}.geojson`
    (190–475 KB); each feature has `code` (INEC) + `name` (+ `state`).
  - Real geography locally: `docker compose down -v && pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm db:seed:dev`
    (the importer refuses a DB holding fake dev units; the dev seed then adds only users). Import takes ~30 s.
  - Current import: 43,867 units; PU locations 26,550 INEC / 3,856 estimated; **Kebbi, Sokoto, Zamfara have no
    locations yet** (none fetched) → 1.5 should fall back to GRID3 ward centroids. `registered_voters` all NULL.
  - GRID3 wards are **CC BY-SA 4.0**: derived `public/geo` ward files must carry that licence + attribution.
- Dev data: `pnpm db:up && pnpm db:migrate && pnpm db:seed:dev` (Kano 19 + Katsina 20, fake names, `source_version = 'dev-fake'`).
  Users: one active per role, PIN `123456`, phones `+234800000xxxx` — ADMIN 0001, DG 0002, Kano chain 0101–0104
  (state → PU 19/01/01/001), Katsina chain 0201–0204 (out-of-scope counterpart). `--reset` deletes only dev rows,
  and refuses once audit_log references dev users (then `docker compose down -v` and re-migrate).
  The seed refuses in production or if real units exist. `db:seed` is reserved for the INEC import (1.4).
- **SMS (2.2):** queue with `enqueueSms(db, …)`; the `sms:process` task runs every minute. **2.4:** after queueing an
  OTP, call `runTask('sms:process')` (from `nitropack/runtime`) so the code arrives in seconds. Dev: messages print as
  `[sms:fake] …` in the dev server console. Manual run in dev: `GET /_nitro/tasks/sms:process`.
  Termii needs `NUXT_SMS_BASE_URL` (account-specific) besides key + sender ID.
  - **👤 Before the pilot (Termii):** from https://app.termii.com copy the API key and base URL (if none is shown, ask
    Termii support; commonly `https://v3.api.termii.com`), and **request a Sender ID early** (3–11 chars, e.g.
    `Tattara`; pending → active after Termii review; ask whether a political sender ID needs extra paperwork for DND
    routes). Put them in `.env` / the host's secrets, never in `.env.example`. Dev/tests keep `NUXT_SMS_PROVIDER=fake`.
- **Scope (2.3), for every route from here on:** `requireScope(event, code)` for single records, `scopeWhere(col, scope)`
  in list queries; pass `{ allowAdmin: true }` only on aggregate/geography routes. Session helpers: import from
  `server/auth/session.ts` (never `#imports`). Node tests that touch sessions must `vi.mock('…/server/auth/session')`
  (unmocked calls hit `test/stubs/` and throw). Audit with `audit(event, { action, targetType, targetId, scopeCode, meta })`;
  meta containing PII throws `AuditPiiError`. **2.4** fills the session user (`SessionUser`: id, role, unitCode, sessionVersion).
- **Auth (2.4):** `@node-rs/argon2` verified in the production build (every E2E login uses it). Local sign-in:
  `pnpm dev` → `/login`, a seeded phone (e.g. `08000000104`) + PIN `123456`; a new browser needs the SMS code, which
  the **fake** provider prints in the dev console. Invites/PIN resets: `sendInvite(db, userId, createdBy, cfg)` (2.5).
  **2.5:** deactivate = `status: 'deactivated'` + bump `session_version` (requireAuth then rejects the old session).
- **Supporters (3.1):** write only through `server/services/supporters.ts` (`createSupporter`, `updateSupporter`,
  `getSupporter`, `serializeSupporter`); it keeps `pu_stats` in step. The phone limit (3.5) and flags (5.1) are not in
  it yet. Routes must map `rejected` reasons to the sync item results (`invalid`, `no_consent`, `out_of_scope`,
  `pu_inactive`). Dev DB has 5,000 supporters: re-run `pnpm db:seed:dev` after `pnpm db:migrate`.
- **Capture (3.3):** `/app/capture` saves online through `POST /api/sync/push` (server side already final); 4.2/4.3
  switch the page to Dexie + outbox and add the client sync engine. Set `NUXT_PUBLIC_ORG_NAME` to the organisation
  named in the consent script (blank = "the party"). E2E web-server timeout is now 10 min (the build can take ~6).
  On a busy laptop, build once and reuse it: `pnpm build && E2E_SKIP_BUILD=1 pnpm test:e2e` (CI still builds in the run).
  - **👤 Before the pilot:** a manual TalkBack pass on `/app/capture` on a real Android Go phone (e2e checks roles,
    labels and keyboard use, not the screen reader itself), and legal + native review of the consent script (7.4).
- **First admin (2.6):** `pnpm admin:create --role ADMIN --name "…" --phone 0806…` prints a 72-hour setup link
  (open it on that phone, choose a PIN); add `--sms` to also text it. The admin then invites the DG at `/app/admin`.
  In production run the same command on the server with its `NUXT_DATABASE_URL` / `NUXT_PUBLIC_SITE_URL`.
- ⚠ **Your local `.env` has `NUXT_SMS_PROVIDER=termii` with live credentials.** With it, `pnpm dev` sends **real SMS**
  (charged), including to the dev seed's made-up `+234800000xxxx` numbers, which may belong to real people. Keep
  `fake` for development; use `termii` only to test delivery to your own phone. Tests and E2E force `fake`.
- New env vars: `NUXT_OTP_SECRET` (required, ≥ 32 chars; set in your `.env`), `NUXT_PUBLIC_SITE_URL` (invite links).
- Migrations need hand-review: drizzle-kit may misorder constraints (0002) or quote custom types (0001).
- drizzle-kit quotes custom geography types in generated SQL; hand-fix to `geography(Point, 4326)` (ADR-017).
- Hausa strings live in `i18n/locales/ha.json5` (ADR-008).

## Log
- 2026-09-26 · 2.5 · Team: `GET /team`, invite (direct children only, replace/supersede/resend), deactivate (session + devices revoked), reset PIN; `/app/team` page with invite/replace/deactivate/reset dialogs; nav by role; `maskPhoneForDisplay`; E2E AC (403 into another ward, deactivated lead's next request 401) green twice · see commit `feat(team)`
- 2026-09-26 · 2.4 · Auth: login (phone+PIN, timing-equal, lockout 5→15 min + supervisor SMS), device OTP (HMAC, device-bound, resend), invite setup (weak-PIN check), logout, `/auth/me`; `requireAuth` on every request; Postgres rate limits; origin check; `/login` + `/setup` pages (Hausa/English, disabled until hydrated); services made Nitro-free; E2E AC green twice on the prod build · see commit `feat(auth)`
- 2026-09-26 · 2.3 · `scope.ts` (`scopeForUser`, `getScope`, `canAccess`, `requireScope`, `scopeWhere` as an index-friendly `~>=~`/`~<~` range; ADMIN denied unless `allowAdmin`), `audit.ts` (`audit`/`recordAudit` with a PII guard), session helpers via `#auth-session`; 100% coverage gate on scope.ts in CI; generic-plan index use verified · see commit `feat(auth)`
- 2026-09-26 · 2.2 · SMS: `SmsProvider` (fake with masked logs, termii with unicode for Hausa), `sms_queue` + `enqueueSms`/`processSmsQueue` (SKIP LOCKED lease, backoff, DB clock, OTP/invite redaction), `sms:process` task every minute; verified in dev (console + DB, schedule fires) and prod build · see commit `feat(sms)`
- 2026-09-25 · 1.3 · Closed: data fetched by script; registered voters moved to field collection by PU leads (new task 3.7, PRD US-24); importer now never overwrites a stored registered-voters figure with NULL · see commit `feat(import)`
- 2026-09-25 · 1.5 · Boundary join (`pnpm geo:build`): Jaro-Winkler names + spatial vote from INEC points, manual crosswalk, unmatched/review CSVs; mapshaper-simplified `public/geo/*` (all under size targets) + ATTRIBUTION; ward polygon points + `boundary_ref` fed to the importer (every unit now located) · see commit `feat(geo)`
- 2026-09-25 · 1.4 · INEC importer (`pnpm db:seed`): normaliser with SEED_DATA §3 checks (counts vs PRD, codes, per-state coordinate boxes, voters), estimated locations, `data/normalised/units.csv`, idempotent upsert + deactivation + `--dry-run`; real import verified (43,867 units, all counts match); dev seed adds users only on real geography · see commit `feat(import)`
- 2026-09-25 · 1.3 (partial) · Fetch scripts for INEC PU locator (hierarchy + coordinates, resumable, polite) and GRID3 boundaries; `data/SOURCES.md` with provenance and licences; `data/raw` + `data/normalised` gitignored · see commit `feat(data)`
- 2026-09-25 · 2.1 · `users` (role ↔ unit level via composite FK + CHECK, one active lead per unit, E.164 phone CHECK), `user_devices`, `invites`, `otp_codes`, `audit_log` (append-only trigger), `unit_targets.set_by` FK; argon2id `hashPin`/`verifyPin`; dev seed users per role (Kano + Katsina chains); `data/` gitignored · see commit `feat(db)`
- 2026-09-25 · 1.2 · Dev seed (geography + targets): deterministic generator (2 states × 3 × 4 × 10, voter sums, PUs ≤ ~1 km from ward), idempotent upsert, `--reset`, production/real-data guards; users → 2.1, supporters → 3.1. Nuxt test hook timeout raised to 60 s (cold-boot flake) · see commit `feat(seed)`
- 2026-09-25 · 1.1 · `units` (code/level/parent CHECKs, text_pattern_ops + GIST indexes, geography point, location_estimated) and `unit_targets`; migration 0001; `normaliseName`; EWKB parser; integration tests for constraints, prefix index and ST_DWithin · see commit `feat(db)`
- 2026-09-25 · 0.5 · Theme (dye/laterite/neem/millet, AA-checked, light only, 17 px base, Noto Sans self-hosted), `default` + `app` layouts (bottom nav on mobile), language switch persisted on device, `/app` + `/app/settings` shells, offline icons; axe + Lighthouse a11y 100 · see commit `feat(ui)`
- 2026-09-25 · 0.4 · Shared enums, roles (level + child-role maps), 7 NW states, pu-code utils (`parsePuCode`, `isWithin`, …), `normalizePhone` (NG mobiles, min metadata), UUIDv7 `newId`; 70 unit tests · see commit `feat(shared)`
- 2026-09-25 · 0.3 · Drizzle 0.45 + postgres.js client (`createDb`, `useDb`), drizzle-kit config, migration 0000 enables PostGIS, `db:up/generate/migrate/studio`, integration test on a fresh template0 DB, PostGIS service in CI · see commit `feat(db)`
- 2026-09-25 · 0.2 · Vitest 5 (unit + nuxt projects), Playwright (Pixel 5, prod build), Husky + lint-staged + commitlint, .nvmrc 24, .gitattributes (LF), GitHub Actions CI; Hausa-always default (ADR-010) · see commit `chore(tooling)`
- 2026-09-25 · 0.1 · Nuxt 4.5.2 + compat 5, Nuxt UI 4.11.2, i18n 10.6, vite-pwa 1.1.1, nuxt-auth-utils 0.5.30, eslint, test-utils; strict TS; folder skeleton; bilingual index page · see commit `chore(scaffold)`
- 2026-09-25 · docs · Project docs created (PRD, plan, architecture, data model, API, security, UX, seed) · —
- 2026-09-26 · 2.6 · Admin bootstrap: `pnpm admin:create` (only way to create an ADMIN; also DG, `--replace`, `--sms`); `GET /admin/dg` + `POST /admin/users/dg` (ADMIN only, one active DG, replace/supersede/resend, SMS invite, token never returned); `/app/admin` page + nav; E2E admin → DG → PIN, 403 for others, axe clean · see commit `feat(admin)`
- 2026-09-26 · 3.1 · Supporters schema: `supporters` (consent/phone/anonymisation/PU CHECKs), `flags`, `pu_stats` (migration 0006); `server/services/supporters.ts` (create: idempotent by client id, own-PU only; update: LWW, audited field names; `serializeSupporter` masking; incremental `pu_stats` = recompute); dev seed + 5,000 supporters with planted flag patterns; meta-test: no supporter selects outside services · see commit `feat(supporters)`
- 2026-09-26 · 3.2 · `shared/schemas/supporter.ts`: `supporterFieldsSchema` / `supporterFormSchema` (consent tick) / `supporterInputSchema` (UUIDv7, PU code, known consent version matching its language, consent ≤ capture + 60 s, GPS ranges) / `supporterPatchSchema` (editable fields only); strict objects reject unknown keys; `shared/constants/consent.ts` versions; `supporter.errors.*` in ha/en; output type = `SupporterInput` (type-checked) · see commit `feat(supporters)`
- 2026-09-26 · 3.3 · Capture page `/app/capture` (PU leads; nav): UForm + `supporterFormSchema` with translated errors, chip radio groups, consent notice (HA/EN, tick time = consentAt), silent GPS (`useSilentGps`, fixes ≤ 2 min), sticky Save, clear + refocus + session counter; `POST /api/sync/push` + `pushSupporters` (per-item results, 120/min); consent scripts in `shared/constants/consent.ts` + `NUXT_PUBLIC_ORG_NAME`; E2E keyboard-only save, errors in ha/en, 403 for others, axe clean · see commit `feat(capture)`
- 2026-09-27 · 3.4 · Supporter list `/app/supporters` (search: name contains / full phone / last ≥ 4 digits; ward lead PU filter; cursor paging by UUIDv7 id) + detail/edit `/app/supporters/[id]` (PU lead edits changed fields only; ward lead read-only) + removal request (audited, no hard delete); routes GET/PATCH `/supporters/:id`, GET `/supporters`, POST `/supporters/:id/removal`; migration 0007 `pg_trgm` + trigram indexes; `SupporterChoiceGroup` + `useSupporterOptions` shared with capture · see commit `feat(supporters)`
