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
- Build warns that Nitro's `runtime/utils/cache-driver.mjs` can't be resolved: harmless, the 60 s stats cache works in
  the production build (E2E `stats.spec.ts`, 6.1).
- **PWA (4.1):** `service-worker/sw.ts` (injectManifest). Icons come from `pnpm icons` (renders `public/icons/*.png`
  with Playwright's Chromium). The service worker only runs in a production build (`pnpm build && pnpm preview`).
  - Offline, `/app` opens without a confirmed session; since 4.5 it stays behind the lock screen (local session +
    PIN). The 4.1 obligation is met (ADR-036).
  - **Size budget:** the precache is ~1.6 MB raw / ~775 KB over the wire (one-time download; ~430 KB are the Noto Sans
    fonts for Hausa letters). Review in 7.x before adding more to the app shell. **6.3:** 1.9 MB raw (86 entries) with
    the new pages; MapLibre is excluded and cached on use (ADR-047).
  - **👤 Before the pilot:** install from Chrome on a real Android Go phone (Add to home screen), open it in airplane
    mode, and check the icon on the home screen. Playwright can't click Chrome's own install UI.
- **Offline lock (4.5, ADR-036), for 4.2 onwards:** the Dexie db is `app/offline/db.ts` (v1 `meta`, v2 supporters/
  outbox/units since 4.2; a new table means **version 3**). `wipeDevice()` deletes the whole database.
- **Sync engine (4.3, ADR-038) + Sync screen (4.4, ADR-039):** `syncNow`/`runSync` in `app/offline/sync.ts`; UI state
  from `useSync()`; live local data with `useLiveQuery(fn, initial)` (Dexie liveQuery) and `useOnline()`. Status pill
  `CommonSyncPill` (PU leads) in the app header; `/app/sync` lists refused/waiting/sent captures of this phone. Pulled
  records (no `deviceId`): local `supporters`, `units`, `getPullStats()`, `getLastPullAt()`; 'last sent' = `getLastSyncAt()`.
  Use `getLocalSession()` (unit, role, name) for offline screens instead of `/api/auth/me`. E2E: shared sessions are
  saved with `indexedDB: true`; a spec that waits on idle uses `page.clock` (E2E idle limit is 120 min).
  Pages under `/app` render behind the lock (still mounted): don't autofocus or fetch-and-announce on mount
  assuming the lead can see the page.
  - Docker Desktop on this machine hung on first start today (engine API 500); quitting and restarting it fixed it.
  - **👤 Before the pilot (Background Sync):** on a real Android phone, capture offline, close the app, turn data on,
    and check the capture reaches the server without reopening the app (Playwright can't fire `sync`).
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
- **Access matrix (3.6):** every new route needs an entry in `test/e2e/access/matrix.ts` (the unit meta-test fails
  otherwise). Run it alone: `E2E_SKIP_BUILD=1 npx playwright test --project=access` (after `pnpm build`).
- **5.6 sign-up links skipped for now (2026-10-08):** waiting on 👤 legal sign-off of self-ticked consent (PRD Q7) and
  the `s1-ha`/`s1-en` wording. Phase 6 went ahead first, at the user's request.
- **Map (6.3, ADR-047):** `/app/map` (lazy `MapUnitMap`, MapLibre only there), `/app/units/[code]` dashboard,
  `GET /api/geo/pus`. Dev geography codes overlap the real GRID3 codes only in part, so some dev units show as "no data"
  on the map; with the real INEC import every unit joins.
  - **👤 Before the pilot:** pan and drill down the map on a real 2 GB Android Go phone (AC: ≥ 30 fps), e.g. with Chrome
    DevTools remote debugging → Performance → FPS meter, at ward level in Kano (the largest ward file).
  - `useFetch` with a fixed `key` and a changing URL didn't refetch on drill-down: give such calls no key (or a reactive one).
- **Home (6.2, ADR-046):** `HomePuHome` (offline-capable; `app/offline/home.ts`) and lazy `HomeUnitDashboard` +
  `HomeChildUnitsTable`; SVG charts in `app/components/charts/`. 6.5 adds an "Inactive leads" card to the dashboard.
  Gotcha found here: never pass a Vue reactive value to Dexie (`DataCloneError`); store a plain object.
- **Stats (6.1, ADR-045):** `server/services/stats.ts` (`unitStats`, `childrenStats`, `sortChildren`, `writeDailyStats`,
  `reconcilePuStats`); routes cached 60 s; `pnpm perf:stats` re-measures the AC (p95 75 ms). 6.2 dashboards read
  `/api/stats/unit/:code` + `/children/:code`; `last30Days` fills only after `stats:daily` runs (dev:
  `GET /_nitro/tasks/stats:daily`).
- **Quality (5.5, ADR-044):** `computeQuality(db)` rebuilds `unit_quality` (nightly `quality:compute`, dev:
  `GET /_nitro/tasks/quality:compute`); `qualityFor(db, codes)` reads it; the Team list shows it. The sync push now runs
  its flag checks and thank-you queueing after the response (`server/utils/after-response.ts`).
- **Flag review (5.4, ADR-043):** `/app/review` = `ReviewCallbacks` (ward leads) + `ReviewFlags` (ward, LGA, state, DG).
  Service `server/services/flag-review.ts` (`listFlags`, `resolveFlag`, `FLAG_REVIEW_ROLES`). E2E now also signs in the
  Kano LGA lead through the UI (`LGA_AUTH_STATE_FILE`); API-only sessions from the access setup can't open `/app` (no
  local PIN session). Confirmed/dismissed counts per lead are ready for 5.5's quality score.
- **Call-backs (5.3, ADR-042):** `callbacks:sample` at 05:00 Lagos (dev: `GET /_nitro/tasks/callbacks:sample`; the dev
  seed's supporters are all received today, so nothing is sampled until tomorrow or you backdate `created_at`).
  `/app/review` is the review page; 5.4 adds the flags section there and opens it to LGA+. `passRate(db, unitCode)`
  works for any unit prefix (5.5). Dates per Lagos day: `shared/utils/lagos-date.ts`.
- **Supporter SMS (5.2, ADR-041):** thank-you queued at sync (`queueThankYous`), delivery reports and STOP through
  `POST /api/webhooks/sms`, hourly `supporters:anonymise`. **Add `NUXT_PHONE_HASH_SECRET` (≥ 32 random chars) to your
  `.env`**: without it thank-yous aren't queued (logged, push still works) and STOP fails. To try STOP locally, POST a
  body signed with `signSmsWebhook(body, NUXT_SMS_WEBHOOK_SECRET)` in `X-Termii-Signature`.
  - **👤 Before the pilot (Termii):** get a **two-way number** for STOP replies (an alphanumeric sender ID can't receive
    them) and set `NUXT_SMS_REPLY_NUMBER`; set the webhook URL (`/api/webhooks/sms`) and secret in Termii; send one real
    message and reply STOP, and check both events against `parseSmsWebhook` (the inbound format isn't documented).
    Native review of the thank-you and confirmation texts (`SUPPORTER_SMS_TEXT`).
- **Flags (5.1, ADR-040), for 5.2–5.5:** `runFlagChecks(db, { supporterIds?, gpsFlagMeters })` / `flagAfterWrite`;
  nightly `flags:scan` (dev: `GET /_nitro/tasks/flags:scan`); after resolving flags call `refreshFlaggedOpen(db, puCodes)`.
  The dev seed now leaves open flags (40 gps_far, 50 duplicate_phone, 1 pu_over_capacity, 1 rate_anomaly, 25 gps_cluster).
- **Registered voters (3.7) — obligations for later tasks:** 5.1 `pu_over_capacity` and every coverage % must skip PUs
  with `registered_voters IS NULL`; 6.4's default target split falls back to PU count when figures are missing;
  stats routes use `/api/units/:code/...`-style dashed codes (`toUrlCode`). Only PU figures are meaningful: ward/LGA
  `registered_voters` values written by the importer are stale once leads report; always sum PUs.
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
- 2026-09-27 · 3.5 · Shared-phone rule: max 3 supporters per number system-wide (`MAX_SUPPORTERS_PER_PHONE`), enforced on create and phone edits under a per-number advisory lock (5 concurrent saves → exactly 3); 2nd/3rd use accepted (flagged in 5.1); `phone_limit` in push results and PATCH 409; `GET /supporters/check-phone` (counts only, PU leads, 60/min) + inline notice on capture when the phone field is left · see commit `feat(supporters)`
- 2026-09-27 · 3.6 · Access-control suite: `test/e2e/access/` matrix of all 18 routes × 11 callers (status + field checks: full vs masked phones, counts-only check-phone, no token/PIN/device keys in any response), real HTTP on the production build, runs first in E2E; unit meta-test keeps the matrix in step with `server/api/`; verified it catches a wrong status and unmasked phones · see commit `test(access)`
- 2026-09-27 · 3.7 · Registered voters from the field: migration 0008 (`registered_voters_reported_by/_at`, CHECK); `setRegisteredVoters` (own PU lead or ward lead, 0–10,000, audited from/to) + `registeredVotersSummary` (PU figure, or sum + reported X of Y); `GET/PUT /api/units/:code/registered-voters` (dashed codes, `all`); importer never overwrites a reported figure; Home card + once-per-device prompt (PU) / totals (ward+), Team page correct button; access matrix 20 routes · see commit `feat(units)`
- 2026-09-27 · 4.1 · PWA: injectManifest service worker (precache app, `/app` network-first with cached shell fallback, `/geo` cache-first, `/api` never cached), manifest with 192/512/maskable PNG icons (`pnpm icons`), install and update prompts (`CommonPwaPrompts`), offline `/app` opens without the login redirect; E2E: manifest + icon sizes, shell opens offline after a first visit, no `/api` entries in any cache · see commit `feat(pwa)`
- 2026-10-07 · 4.5 · Offline session & idle lock (done before 4.2, ADR-036): Dexie db (`meta` only) + `wipeDevice`; PBKDF2 PIN verifier (600k) and `/auth/me` snapshot saved at login/OTP/setup (another lead → wipe first); `useAppLock` + `CommonAppLock` cover `/app` (inert, still mounted) after `NUXT_PUBLIC_LOCK_IDLE_MINUTES` idle, also on cold start; 5 wrong PINs → wipe + sign-out; "sign in again" without a local session; 401 `data.reason` `revoked`/`expired` with a sticky revoked marker in the session, so revoked phones wipe on next contact and expired ones keep data; sign-out always wipes; unit + integration tests, E2E lock/unlock offline, 5-wrong wipe, sign-out wipe, deactivated lead wiped · see commit `feat(offline)`
- 2026-10-07 · 4.2 · Dexie layer (ADR-037): db v2 adds `supporters`/`outbox`/`units`; `outbox.ts` (atomic idempotent `saveCapture`, `applyResults`, `discardCapture`, `countLocalPhone`) + `push.ts` (`pushOutbox`, oldest ≤ 50, unanswered rows stay queued); capture saves locally then pushes once when online ("Saved" vs "Saved on this phone"), keeps the form on an immediate refusal, toasts refusals of earlier captures; PU from the local session offline; offline duplicate notice from the phone copy; unit tests (fake-indexeddb) + E2E offline capture → reload offline → online save sends both exactly once · see commit `feat(offline)`
- 2026-10-07 · 4.3 · Sync engine (ADR-038): `GET /api/sync/pull` (own PU / ward only, full records, tombstones for anonymised, `(updated_at ms, id)` cursor pages of 500, 2-min overlapping `serverTime`, unit subtree + summed stats; 60/min; access matrix 21 routes); `runSync`/`syncNow` (all due batches each once per run, then pull; Web Lock shared with the SW; coalescing), backoff 30 s→30 min with jitter, pull never overwrites queued/refused captures, unit change starts over; plugin triggers (start, sign-in, online, 60 s, visible, SW message); capture uses the engine + registers Background Sync; SW `sync` pushes the outbox itself; persistent storage requested + Settings warning; unit (fake-indexeddb), integration and E2E (20 offline → online → 20 exactly once; push answer lost + app killed → no duplicates) · see commit `feat(offline)`
- 2026-10-07 · 4.4 · Sync screen + status pill (ADR-039): `CommonSyncPill` in the header (PU leads; offline / sending / waiting / all sent / refused, never red; live Dexie counts), `/app/sync` (refused with plain-words reason + issues, Fix → capture prefilled with consent asked again, Remove with confirm; waiting with tries; latest 50 sent; Try sending now; last sent time); nav item; `listLocalCaptures`, `captureCounts`, `getRejected`, `removeRejected`, `lastSyncAt`; ha/en strings (ha marked for review); unit + E2E (pill and groups through offline → online, fix and remove a refused capture, axe) · see commit `feat(sync)`
- 2026-10-08 · 5.1 · Flag engine (ADR-040): `server/services/flags.ts` set-based checks gps_far (accuracy allowed, 10 km for estimated PU locations), duplicate_phone (later uses only), pu_over_capacity (> 90% of reported voters), rate_anomaly (> 60/rolling hour, device clock, per lead), gps_cluster (≥ 10 identical fixes); reviewed flags not re-raised; migration 0009 (one open per PU/lead flag); runs after sync push and phone edits (never fails the save) and nightly `flags:scan`; `pu_stats.flagged_open` refreshed; dev seed raises its planted flags; integration tests per flag type against the planted fixtures + edge cases, unit tests for thresholds and wiring · see commit `feat(flags)`
- 2026-10-08 · 4.3/4.4 fix · Found by the 5.1 E2E run: the pull dropped `deviceId` from this phone's sent captures (they vanished from the Sent list), and capture showed "Saved on this phone" when a run already in progress had sent the record; pull now keeps `deviceId`, capture reads the record's status (`captureStatus`) · see commit `fix(sync)`
- 2026-10-08 · 5.2 · Thank-you SMS + STOP (ADR-041): migration 0010 (`opted_out_at`, `sms_queue.supporter_id`, purpose `opt_out_confirm`, `sms_opt_outs` hashed numbers); thank-you after sync in the consent language (one per number per 24 h, never to opted-out numbers); `POST /api/webhooks/sms` (HMAC-SHA512 signature, delivery reports verify the number's supporters, STOP opts out every record on the number, audited by id, confirmation once); hourly `supporters:anonymise` (all removal requests, then finished SMS to those numbers); `opt_out_spike` lead flag; new env `NUXT_PHONE_HASH_SECRET`, `NUXT_SMS_REPLY_NUMBER`; unit (signature, parser, STOP words, GSM-7 texts) + integration tests, access matrix 22 routes · see commit `feat(sms)`
- 2026-10-08 · 5.3 · Call-backs (ADR-042): migration 0011 `callbacks` (ward-scoped, one per supporter); daily `callbacks:sample` (5% per ward rounded up, previous Lagos day, catch-up within a week, idempotent); `GET /api/callbacks` (today + overdue, 30-day pass rate) and `POST /api/callbacks/:id` (final outcome → callback_verified / callback_failed + flag, audited, notes without phone numbers); `/app/review` page with tap-to-call and outcome chips; nav for ward leads; ha/en strings; `recordAudit` accepts a transaction; integration, unit and E2E tests (+ axe), access matrix 24 routes · see commit `feat(callbacks)`
- 2026-10-08 · 5.4 · Flag review (ADR-043): migration 0012 `flags.review_note`; `GET /api/flags` (scope per role, full supporter for ward leads and masked above, lead/PU subjects, open counts, cursor paging) and `POST /api/flags/:id/resolve` (dismiss/confirm with a note, latest review wins, audited without the note, flagged_open refreshed); Review page split into call-backs + flags (tabs, type chips, evidence sentences, review dialog) for ward/LGA/state/DG; nav; ha/en strings; `containsPhoneNumber` shared; integration, unit (evidence sentences in both languages) and E2E (ward dismisses with note, LGA sees masked, axe) tests; access matrix 26 routes · see commit `feat(flags)`
- 2026-10-08 · 5.5 · Lead quality score (ADR-044): `shared/utils/quality.ts` formula (50% verified incl. call-back pass rate, 25% flags, 25% opt-outs; ≥ 10 supporters; 90 days); migration 0013 `unit_quality`; nightly `quality:compute` (per-PU counts rolled up to ward/LGA/state); `/api/team` fills `qualityScore` + `quality` breakdown; Team page badge (number + word) with "Why this score"; dev seed computes it; sync push answers before flag checks and thank-you queueing; unit, integration and E2E tests · see commit `feat(quality)`
- 2026-10-08 · 6.1 · Stats (ADR-045): `GET /api/stats/unit/:code` (totals, breakdowns, registered voters, coverage over reported PUs, target/progress, last 30 days) and `GET /api/stats/children/:code` (per child: supporters, verified %, flags, coverage, progress, active leads; sorted by metric, missing last), 60 s `defineCachedFunction` cache (confirmed in prod build by E2E); migration 0014 `unit_daily_stats` + `stats:daily` (23:55 Lagos) and `stats:reconcile` (02:00 UTC, logs and fixes drift); `pnpm perf:stats`: children/all p95 75 ms on 41,671 PUs × 5M supporters (AC < 300 ms); unit, integration and E2E tests, access matrix 28 routes · see commit `feat(stats)`
- 2026-10-08 · 6.2 · Role-aware home (ADR-046): PU lead home (Add supporter, added today, waiting, total vs target ring; works offline from the phone + last online numbers) and lazy ward-and-above dashboard (summary with coverage, verified %, target ring, 30-day trend; open flags → Review; units below lowest coverage first, linking to Team `?unit=`); SVG trend line + progress ring without a chart library; ha/en strings; unit (chart maths, Lagos-day count) and E2E (PU home online/offline, no dashboard chunk for PU leads, ward table order, LGA drill-down, axe) tests · see commit `feat(home)`
- 2026-10-09 · 6.3 fix · Map drew nothing: MapLibre worker now loaded as a bundled asset (cached on use, not precached); drill-down into a ward fits to its PU points once they load; E2E asserts features are rendered; Nuxt test project gets fake-indexeddb (removes 2 unhandled Dexie rejections) · see commit `fix(map)`
- 2026-10-08 · 6.3 · Map (ADR-047): `/app/map` with MapLibre 6.13 (lazy, dynamic import, left out of the SW precache and cached on use): children shaded by coverage/supporters/verified/flags/progress/active leads, fixed coverage classes + quantiles, hatched no-data, legend, breadcrumb within scope, bottom sheet (zoom in, open dashboard, team), PU points at ward level; table as accessible alternative with hover highlight; `GET /api/geo/pus`; `/app/units/[code]` dashboard; nav; ha/en strings; unit (map maths, precache filter), integration (PU points) and E2E (ward map + sheet + dashboard, LGA drill-down, no MapLibre on capture/PU home, axe) tests; access matrix 30 routes · see commit `feat(map)`
