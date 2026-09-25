# Implementation Plan — Tattara

Work top to bottom. Each task is one Claude Code session, one commit. Tick `[x]` when all
acceptance criteria (AC) pass, then log it in PROGRESS.md. Tasks marked 👤 need the human.

---

## Phase 0 — Foundation

- [x] **0.1 Scaffold Nuxt app**
  The repo already holds docs and config, so scaffold into a temp folder with `pnpm create nuxt@latest` (current 4.5.x) and move the files in without overwriting CLAUDE.md, docs/, .claude/, .mcp.json, .gitignore, docker-compose.yml or .env.example. Then add modules with `npx nuxt module add` for: ui, eslint, test-utils, i18n, `@vite-pwa/nuxt`, nuxt-auth-utils.
  Set `future.compatibilityVersion: 5`, `compatibilityDate`, TS strict, `app/` structure per ARCHITECTURE §3.
  **AC:** `pnpm dev` serves a Nuxt UI page; `pnpm lint`, `pnpm typecheck` pass; no module errors under compat 5 (or escape hatch logged in DECISIONS.md).

- [x] **0.2 Tooling**
  Vitest (unit + nuxt env), Playwright, `@nuxt/eslint` flat config, Husky + lint-staged, Conventional Commits, `.env.example`, `.nvmrc` (24), GitHub Actions CI: install → lint → typecheck → test → build.
  **AC:** CI green on a sample test; pre-commit runs lint on staged files.

- [x] **0.3 Local database**
  `docker-compose.yml` with `postgis/postgis:17-3.5` (or current), Drizzle client in `server/db/client.ts`, drizzle-kit config, `db:*` scripts.
  **AC:** `pnpm db:migrate` applies an empty migration; the PostGIS extension is enabled by migration.

- [x] **0.4 Shared foundations**
  `shared/constants/enums.ts`, `roles.ts`, `states.ts` (7 NW states + codes — verify with seed), `shared/utils/pu-code.ts`, `phone.ts` (libphonenumber-js, NG), `uuid.ts` (UUIDv7).
  **AC:** unit tests cover pu-code parse/parent/level/isWithin edge cases and phone normalisation (`0803…`, `803…`, `+234803…`, `234803…`, invalid).

- [x] **0.5 Theme, layouts, i18n shell**
  Nuxt UI theme per UX_GUIDELINES §3, Noto Sans, `default` and `app` layouts (bottom nav on mobile), language switch, `ha.json`/`en.json` with the initial keys.
  **AC:** switching language updates all visible strings without reload; Lighthouse accessibility ≥ 95 on the shell.

## Phase 1 — Geography

- [x] **1.1 Schema: units, unit_targets** (DATA_MODEL §1) + migration + indexes.
- [ ] **1.2 Dev seed** `scripts/seed-dev.ts` (fake geography + users + supporters stub).
  **AC:** `pnpm db:seed` is idempotent; codes are in real format.
- [ ] 👤 **1.3 Obtain INEC PU data + GRID3 boundaries** into `data/raw/`, fill `data/SOURCES.md`.
- [ ] **1.4 INEC importer** `scripts/import-inec-pus.ts` → normalised CSV → DB, with the validation checks in SEED_DATA §3.
  **AC:** prints per-state counts vs expected; zero orphans; re-run is a no-op.
- [ ] **1.5 Boundary importer** per SEED_DATA §4, writing `public/geo/*`.
  **AC:** all 186 LGAs matched; ward match ≥ 98% before the manual crosswalk, 100% after.

## Phase 2 — Accounts & hierarchy

- [ ] **2.1 Schema:** users, user_devices, invites, otp_codes, audit_log.
- [ ] **2.2 SMS abstraction** `server/utils/sms/` with `fake` + `termii` providers, `sms_queue` table and a Nitro task processor.
  **AC:** in dev, sends appear in the console and the DB; provider errors retry with backoff.
- [ ] **2.3 Scope utils** `server/utils/scope.ts` (`getScope`, `requireScope`, `scopeWhere`) + `audit.ts`.
  **AC:** 100% unit test coverage on scope.ts.
- [ ] **2.4 Auth flows:** login (phone+PIN), new-device OTP, invite setup, logout, `/auth/me`, lockout, rate limits.
  **AC:** e2e: invited PU lead sets a PIN → logs in → OTP on second device → locked after 5 bad PINs.
- [ ] **2.5 Team management:** `/team` routes + Team page; the invite form only allows direct child units; deactivate/replace.
  **AC:** a ward lead cannot invite into another ward (403, tested); deactivation revokes the session on next request.
- [ ] **2.6 Admin bootstrap:** CLI `scripts/create-dg.ts` + `/admin/users/dg`.

## Phase 3 — Supporter capture (online)

- [ ] **3.1 Schema:** supporters, flags, pu_stats; the service `server/services/supporters.ts` with create/update/serialize and incremental pu_stats updates.
- [ ] **3.2 Shared Zod schema** `shared/schemas/supporter.ts` (consent required, enums, max lengths).
- [ ] **3.3 Capture page** per UX §4.1 using Nuxt UI `UForm` + chip groups; consent script from `shared/constants/consent.ts`; silent GPS.
  **AC:** keyboard-only and TalkBack usable; required-field errors in the active language.
- [ ] **3.4 Supporter list + detail + edit** (PU & ward), search by name/phone, cursor pagination.
- [ ] **3.5 Phone duplicate check** (`/supporters/check-phone`) + the shared-phone rule (max 3).
- [ ] **3.6 Access-control test suite** table-driven over every supporter/user/stats route × role × in/out-of-scope.
  **AC:** the suite runs in CI; any new route without a matrix entry fails a meta-test.

## Phase 4 — Offline-first & PWA

- [ ] **4.1 PWA setup** (`@vite-pwa/nuxt`, injectManifest, custom `sw.ts`): precache the app shell, runtime-cache `/geo/*` (CacheFirst), never cache `/api/supporters*`. Install prompt UX, update prompt ("New version — reload").
  **AC:** installable on Android Chrome; app shell loads in airplane mode after the first visit.
- [ ] **4.2 Dexie layer** `app/offline/db.ts`, `outbox.ts`; capture writes locally first.
- [ ] **4.3 Sync engine** `app/offline/sync.ts` + `/api/sync/push` + `/api/sync/pull`; backoff; Background Sync trigger from the SW; `navigator.storage.persist()`.
  **AC:** e2e (Playwright offline mode): capture 20 supporters offline → go online → all 20 accepted exactly once; killing the app mid-sync causes no duplicates.
- [ ] **4.4 Sync screen + status pill** per UX §4.5.
- [ ] **4.5 Offline session & idle lock** local PIN verifier, 5-min idle lock, device wipe on logout/deactivation.

## Phase 5 — Data quality

- [ ] **5.1 Flag engine** `server/services/flags.ts`: gps_far, duplicate_phone, pu_over_capacity, rate_anomaly, gps_cluster, run at sync + nightly.
  **AC:** unit tests per flag type with fixtures.
- [ ] **5.2 Thank-you SMS + STOP webhook** → verification/opt-out state; anonymise job (72 h).
- [ ] **5.3 Call-back workflow:** daily sample task, ward review page, outcomes update verification.
- [ ] **5.4 Flags review page** (ward full, LGA+ masked) + resolve actions, audited.
- [ ] **5.5 Lead quality score** computed nightly; shown in Team lists.

## Phase 6 — Dashboards & map

- [ ] **6.1 Stats service + routes** (`/stats/*`) with 60 s cache; `unit_daily_stats` nightly task; reconcile task.
  **AC:** `/stats/children/all` < 300 ms p95 on 41,671 PUs × 5M supporters (seeded load data).
- [ ] **6.2 Role-aware home dashboards** per UX §4.2 (Nuxt UI dashboard components; charts with a light lib, lazy-loaded).
- [ ] **6.3 Map page** MapLibre, choropleth drill-down State→LGA→Ward→PU points, metric switcher, breadcrumb, bottom sheet, legend.
  **AC:** map JS is not in the capture route bundle; drill-down works on a 2 GB Android device at ≥ 30 fps pan.
- [ ] **6.4 Targets** set/distribute + progress display.
- [ ] **6.5 Leaderboard + inactive leads.**

## Phase 7 — Hardening & pilot

- [ ] **7.1 Security headers, CSP, rate limits review, dependency audit.**
- [ ] **7.2 Load test** (k6): 330 sync pushes/s for 10 min without errors; DB CPU < 70%.
- [ ] **7.3 Observability:** structured logs, error tracking with PII scrubbing, client sync telemetry.
- [ ] 👤 **7.4 Hausa language review** of all strings + consent text; legal review of consent + DPIA.
- [ ] **7.5 Admin tools:** units import with dry-run diff, audit viewer, export request/approve flow.
- [ ] **7.6 Deploy** staging + prod (IaC or documented runbook in `docs/RUNBOOK.md`), backups, PITR.
- [ ] 👤 **7.7 Pilot in 2 LGAs**; collect feedback in `docs/PILOT_FEEDBACK.md`; fix top 10 issues.

## Phase 8 — v1.1 Communication
- [ ] 8.1 SMS templates + approval, broadcasts with estimate/confirm, daily caps.
- [ ] 8.2 Announcements feed.
- [ ] 8.3 Inactive-lead SMS nudges.

## Phase 9 — v2 Election day (plan in detail before starting)
- [ ] 9.1 Turnout marking (offline) + live turnout map.
- [ ] 9.2 EC8A capture (photo + figures) + IReV comparison flags.
- [ ] 9.3 Incident reporting.
- [ ] 9.4 Polling agent roster & assignment.
