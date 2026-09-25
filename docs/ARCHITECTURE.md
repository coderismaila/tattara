# Architecture — Tattara

## 1. High-level

```
 ┌──────────── Android phone (PWA) ─────────────┐
 │ Nuxt app (Vue, Nuxt UI)                      │
 │  ├─ Capture / list / dashboard pages         │
 │  ├─ Dexie (IndexedDB): outbox, supporters,   │
 │  │   my-unit cache, geography subset         │
 │  └─ Service worker (Workbox): app shell,     │
 │      static geo, background sync trigger     │
 └───────────────┬──────────────────────────────┘
                 │ HTTPS (JSON), cookie session
 ┌───────────────▼──────────────────────────────┐
 │ Nitro server (Nuxt server/)                  │
 │  api/ → services/ → db (Drizzle)             │
 │  utils: auth, scope, audit, sms, rate-limit  │
 │  tasks: stats rollup, flag jobs, SMS queue   │
 └───────┬───────────────────────┬──────────────┘
         │                       │
 ┌───────▼────────┐     ┌────────▼────────┐
 │ Postgres 17 +  │     │ SMS provider    │
 │ PostGIS        │     │ (Termii)        │
 └────────────────┘     └─────────────────┘
```

One Nuxt app serves both the PWA and the API. SSR is **off** for app routes (they're behind auth
and must work offline); marketing/login pages may prerender.

## 2. nuxt.config.ts (starting point — verify option names against current docs)

```ts
export default defineNuxtConfig({
  future: { compatibilityVersion: 5 },
  compatibilityDate: '2026-09-25',
  modules: [
    '@nuxt/ui',
    '@nuxt/eslint',
    '@nuxt/test-utils/module',
    '@nuxtjs/i18n',
    '@vite-pwa/nuxt',
    'nuxt-auth-utils',
  ],
  css: ['~/assets/css/main.css'],
  ssr: true,
  routeRules: {
    '/app/**': { ssr: false },   // authenticated SPA shell, cached by SW
    '/': { prerender: true },
  },
  i18n: {
    defaultLocale: 'ha',
    locales: [
      { code: 'ha', language: 'ha-NG', name: 'Hausa', file: 'ha.json' },
      { code: 'en', language: 'en-NG', name: 'English', file: 'en.json' },
    ],
    strategy: 'no_prefix',
  },
  pwa: {
    strategies: 'injectManifest',
    srcDir: 'service-worker',
    filename: 'sw.ts',
    registerType: 'prompt',
    manifest: {
      name: 'Tattara',
      short_name: 'Tattara',
      lang: 'ha',
      start_url: '/app',
      display: 'standalone',
      theme_color: '#0F5132',
      background_color: '#FFFFFF',
      icons: [/* 192, 512, maskable */],
    },
  },
  runtimeConfig: {
    databaseUrl: '',
    sms: { provider: 'fake', apiKey: '', senderId: '', webhookSecret: '' },
    session: { password: '' },   // nuxt-auth-utils, ≥ 32 chars
    public: { appVersion: '', gpsFlagMeters: 3000 },
  },
})
```

## 3. Folder structure

```
app/
  app.config.ts               Nuxt UI theme (primary colour etc.)
  assets/css/main.css         @import "tailwindcss"; @import "@nuxt/ui";
  layouts/  default.vue (public), app.vue (authenticated shell w/ bottom nav)
  middleware/ auth.global.ts  redirects unauthenticated users on /app/**
  pages/
    index.vue                 landing/login redirect
    login.vue, setup.vue      PIN login, invite setup
    app/
      index.vue               role-aware home (my unit summary)
      capture.vue             add supporter (PU lead)
      supporters/index.vue    list + search (PU/Ward)
      supporters/[id].vue     view/edit
      team/index.vue          leads below me, invite, deactivate
      map.vue                 map drill-down (lazy)
      dashboard/[code].vue    unit dashboard by PU-code prefix
      review/index.vue        flags + call-back queue (Ward/LGA)
      sync.vue                outbox status
      settings.vue            language, logout, device
  components/  capture/, dashboard/, map/, team/, common/
  composables/ useSession, useScope, useSync, useOnline, useGeo, useUnit
  offline/
    db.ts                     Dexie schema
    outbox.ts                 enqueue / list / retry
    sync.ts                   push outbox, pull my-unit data
service-worker/sw.ts          Workbox precache + runtime caching + sync trigger
server/
  api/…                       see API.md
  services/                   supporters.ts, users.ts, stats.ts, flags.ts, sms.ts, exports.ts
  db/schema/*.ts, db/client.ts, db/migrations/
  utils/ auth.ts, scope.ts, audit.ts, rate-limit.ts, sms/{index,termii,fake}.ts
  tasks/                      Nitro scheduled tasks: stats rollup, flags, sms queue
shared/
  schemas/ supporter.ts, user.ts, auth.ts
  constants/ roles.ts, states.ts, enums.ts
  utils/ pu-code.ts, phone.ts, uuid.ts
public/geo/ nw-states.geojson, nw-lgas.geojson, wards/{stateCode}.geojson
scripts/ import-inec-pus.ts, import-grid3-boundaries.ts, seed-dev.ts
data/ (gitignored raw source files)
```

## 4. Hierarchy and scope model

The INEC PU code `SS/LL/WW/PPP` **is** the hierarchy. Every geographic unit has a code:

| Level | Code example | Meaning |
|---|---|---|
| Region | `` (empty) | all NW |
| State | `19` | Kano |
| LGA | `19/05` | an LGA in Kano |
| Ward | `19/05/03` | a ward in that LGA |
| PU | `19/05/03/012` | a polling unit |

- Each user has one `unitCode`. Their **scope prefix** is `unitCode + '/'` (or `''` for DG).
- A record is in scope iff `record.puCode` equals the unitCode (PU lead) or starts with the scope prefix.
- Postgres: `pu_code text` with a `text_pattern_ops` btree index makes `LIKE '19/05/%'` fast.
- `server/utils/scope.ts` exposes:
  - `getScope(event) → { role, unitCode, prefix }`
  - `requireScope(event, code)` throws 403 if `code` is outside scope
  - `scopeWhere(column, scope)` returns a Drizzle SQL fragment for list queries

Codes are stored zero-padded exactly as INEC publishes them. `shared/utils/pu-code.ts` has
`parse`, `format`, `parent`, `level`, `isWithin(code, prefix)`, all unit-tested.

## 5. Offline-first capture and sync

**Principles:** the client is the source of new supporter records until synced; the server is the source of truth after.

1. Capture form validates with the shared Zod schema, generates a **UUIDv7** `id`, and writes to
   Dexie `supporters` (status `pending`) **and** `outbox` in one Dexie transaction.
2. `useSync()` runs: on app start, on the `online` event, every 60 s while online, and when the SW
   receives a `sync` event (Background Sync where supported; Android Chrome supports it).
3. The push sends batches of ≤ 50 items to `POST /api/sync/push`. The server upserts by `id` inside
   a transaction, runs validation, dedupe and flag checks, and returns a per-item result:
   `accepted | duplicate | rejected(reason) | conflict`.
4. The client marks items `synced` or `rejected` (shown in the Sync screen with the reason and a fix action).
5. Retries use exponential backoff (max 30 min). Items never auto-delete from the outbox until
   acknowledged.
6. Pull: `GET /api/sync/pull?since=` returns changes to supporters in the lead's scope (PU/Ward only)
   plus my-unit stats, so the offline list stays current.
7. Edits are last-write-wins using `updatedAt` from the server clock. The conflict rate is expected to be tiny
   (only one lead per PU writes).

**Offline duplicate check:** Dexie index on `phone` covers the lead's own PU. The global check happens at sync time and
produces a `duplicate_phone` flag, not a rejection (unless > 3 per number, then `rejected`).

**Storage safety:** call `navigator.storage.persist()` after login; show a warning in Settings if denied.

## 6. Auth

- `nuxt-auth-utils` sealed cookie session: `{ userId, role, unitCode, deviceId, sessionVersion }`.
- **Login:** phone + 6-digit PIN (argon2id hash). A new device (unknown `deviceId` in localStorage) requires an SMS OTP.
- **Session length:** 30 days sliding, so offline users aren't logged out mid-drive. Incrementing `sessionVersion` in the DB
  invalidates sessions on the next online request (used on deactivate/PIN reset).
- **Invite setup:** an invite token (random 128-bit, hashed in DB, 72 h expiry) is delivered by SMS as a short code + link.
- **Rate limits:** login 5/15 min per phone, OTP sends 3/hour per phone, sync push 120/min per user.

## 7. Aggregation for dashboards

- `pu_stats` table: one row per PU with counters (total, verified, flagged, by gender, by age band,
  by support level, last_capture_at). It's updated **incrementally in the same transaction** as supporter
  inserts/updates (via the service layer, not triggers, so the logic stays testable).
- Rollups for ward/LGA/state/region are `GROUP BY left(pu_code, n)` over 41,671 rows — fast enough
  on demand; cache for 60 s with Nitro `defineCachedFunction` keyed by prefix.
- A daily time-series snapshot (`unit_daily_stats`) is written by a Nitro scheduled task at 23:55 WAT for trend charts.
- A nightly reconcile task recomputes `pu_stats` from scratch and logs any drift.

## 8. Maps

- MapLibre GL JS, loaded only on `/app/map` and dashboard pages (dynamic import).
- **Boundaries:** GRID3 Nigeria operational boundaries (state, LGA, ward), simplified with mapshaper
  (states ~1%, LGAs ~3%, wards ~5%), shipped as static GeoJSON and cached by the SW. Ward files are split per state.
- **PU points:** from INEC PU coordinates; served by `GET /api/geo/pus?ward=` for the selected ward only.
- **Join key:** each boundary feature gets a `code` property matching our unit codes during import
  (name matching plus a manual crosswalk file for mismatches — see SEED_DATA.md).
- **Colours:** coverage % in 5 classes (0–10, 10–25, 25–40, 40–60, 60+), a colour-blind-safe sequential ramp, and always a legend.
- **Basemap:** none by default (boundaries on a light background) to save data. An optional light raster/vector
  basemap toggle is allowed where online.

## 9. SMS

`server/utils/sms/index.ts` defines `interface SmsProvider { send(to, text, meta) }`. It is implemented by
`termii.ts` and `fake.ts` (dev/test, writes to the console + table). Sends go through the `sms_queue`
table processed by a scheduled task, which gives retries and a per-scope daily cap. Inbound STOP is handled by
a provider webhook at `POST /api/webhooks/sms`, verified by signature/secret.

## 10. Environments

- **local:** docker compose (postgis/postgis:17), fake SMS.
- **staging:** mirrors prod and uses anonymised seed data only.
- **prod:** managed Postgres with PITR backups, and a Node server behind a reverse proxy with HTTP/2 and TLS.
  The data residency choice is an open question (PRD §10), recorded in DECISIONS.md when made.

## 11. Observability

- Structured JSON logs (pino-style) with a `requestId`; never log phone numbers or names (see SECURITY_PRIVACY).
- Error tracking (Sentry or a self-hosted equivalent) with PII scrubbing.
- Metrics: sync push results by status, outbox age (reported by clients), SMS delivery rate, p95 API latency.
