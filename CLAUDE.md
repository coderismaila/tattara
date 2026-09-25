# CLAUDE.md — Tattara

Tattara (Hausa: "to gather") is an offline-first PWA a political party uses to build a
consented **supporter registry** across the 7 North West Nigeria states, organised on
INEC's official geography: State → LGA → Ward (Registration Area) → Polling Unit (PU).

It is NOT INEC voter registration. Never use the words "register voters" in UI copy;
use "register supporter" / "add supporter" (Hausa: "Ƙara magoyi baya").

## Read these before writing code

| Doc | When |
|---|---|
| `docs/PRD.md` | What we're building and why. Source of truth for scope. |
| `docs/IMPLEMENTATION_PLAN.md` | The ordered task list. Work top to bottom. |
| `docs/PROGRESS.md` | What's done. Update after every task. |
| `docs/ARCHITECTURE.md` | Stack, folders, offline sync, auth, scoping. |
| `docs/DATA_MODEL.md` | Tables, PU codes, indexes. |
| `docs/API.md` | Server route contracts. |
| `docs/SECURITY_PRIVACY.md` | RBAC matrix, masking, consent, NDPA. Non-negotiable. |
| `docs/UX_GUIDELINES.md` | Screens, Hausa/English, low-end Android rules. |
| `docs/SEED_DATA.md` | How INEC geography gets into the DB. |
| `docs/DECISIONS.md` | Architecture decision log. Append when you choose something. |

## Stack (pinned intent — check versions with `pnpm outdated`)

- **Nuxt 4.5.x** (latest patch) with `future: { compatibilityVersion: 5 }`
- **Nuxt UI v4** (`@nuxt/ui`) — use its components before writing custom ones
- **PWA:** `@vite-pwa/nuxt` (Workbox, `injectManifest` strategy with custom SW)
- **Offline store:** Dexie (IndexedDB)
- **DB:** PostgreSQL 17 + PostGIS, **Drizzle ORM** + drizzle-kit migrations
- **Auth:** `nuxt-auth-utils` (sealed cookie sessions), phone + PIN, SMS OTP on new device
- **Validation:** Zod schemas in `shared/schemas/` used by BOTH client forms and server routes
- **Maps:** MapLibre GL JS + simplified GeoJSON boundaries (GRID3) served as static files
- **i18n:** `@nuxtjs/i18n` — locales `ha` (default) and `en`
- **SMS:** provider behind an interface in `server/utils/sms/` (Termii first)
- **Tests:** Vitest + `@nuxt/test-utils`, Playwright for e2e
- **Lint/format:** `@nuxt/eslint` (flat config). No Prettier fights — ESLint stylistic.
- **Package manager:** pnpm. **Node:** 24 LTS.

## Compatibility-mode rules (compatibilityVersion: 5)

compatibilityVersion 5 opts into Nuxt v5 breaking changes early and is marked experimental.
Consequences you must respect:

1. **No Nitro auto-imports in `server/`.** Always import explicitly, e.g.
   `import { defineEventHandler, readValidatedBody, createError } from 'h3'`.
   Import app utils from their file path (`~~/server/utils/...`). Do not rely on `#imports` in server code.
2. If a **third-party module breaks** under v5 compat (known past case: `@nuxt/icon` server handler),
   first check for a module update. Escape hatch: `experimental: { nitroAutoImports: true }`.
   Record any escape hatch in `docs/DECISIONS.md` with the reason and a removal condition.
3. Never downgrade `compatibilityVersion` without asking the human.
4. Verify Nuxt / Nuxt UI APIs against the docs MCP servers (see `.mcp.json`) rather than memory.
   Your training data may predate Nuxt 4.5 and Nuxt UI 4.11.

## Project layout (Nuxt 4 `app/` dir)

```
app/            pages/, components/, composables/, layouts/, middleware/, stores/, assets/
  offline/      Dexie db, sync queue, sync worker
server/
  api/          route handlers (thin — validate, authorize, call services)
  services/     business logic (pure-ish, unit-tested)
  db/           drizzle schema, client, migrations/
  utils/        auth, scope, sms, audit, rate-limit
shared/         schemas/ (zod), types/, constants/ (roles, states), utils/ (pu-code, phone)
public/geo/     simplified GeoJSON (states, lgas, wards)
scripts/        seed + data import scripts
docs/
```

## Commands

```bash
pnpm dev                 # dev server
pnpm build && pnpm preview
pnpm lint && pnpm typecheck
pnpm test                # vitest
pnpm test:e2e            # playwright
pnpm db:generate         # drizzle-kit generate
pnpm db:migrate          # apply migrations
pnpm db:seed             # seed geography from data/ (see SEED_DATA.md)
docker compose up -d db  # local Postgres+PostGIS
```
Create any missing script in `package.json` the first time it's needed.

## Hard rules

1. **Scope every query.** Every server read/write of supporter or user data goes through
   `requireScope(event, puCodeOrPrefix)` in `server/utils/scope.ts`. No exceptions. A user's scope
   is a PU-code prefix (e.g. `19/` = Kano state, `19/05/` = an LGA). See SECURITY_PRIVACY.md.
2. **Mask by default.** Supporter phone numbers leave the server unmasked ONLY for PU and Ward leads
   within scope. Everyone above gets aggregates or masked values.
3. **No new sensitive fields.** Never add PVC number, VIN, NIN, BVN, religion, or ethnicity fields.
   If a request asks for one, stop and ask the human.
4. **Consent is required.** A supporter record without `consentAt` and `consentVersion` must be rejected by the server.
5. **Idempotent writes.** Supporter IDs are UUIDv7 generated on the client. Server upserts by ID.
6. **Audit** every export, role change, account creation, deletion and bulk SMS in `audit_log`.
7. **No secrets in code.** Use `runtimeConfig` + `.env`. Update `.env.example` when adding a variable.
8. **Hausa first.** Every user-facing string goes through i18n with both `ha` and `en` keys.
   Mark machine-drafted Hausa with a `// TODO(ha-review)` comment in the locale file.
9. **Low-end devices.** Target a 2 GB RAM Android Go phone on 3G. Keep the capture route JS small;
   lazy-load maps and dashboards.
10. **Flags, not blocks.** Fraud heuristics (GPS distance, duplicate phones, over-target PUs) create
    flags for review; they do not block saving (except hard validation failures).

## Workflow for each task

1. Read the task in `docs/IMPLEMENTATION_PLAN.md` and its acceptance criteria.
2. Plan briefly. If the task conflicts with the PRD or SECURITY_PRIVACY, stop and ask.
3. Implement with tests (unit for services/utils, e2e for user flows where listed).
4. Run `pnpm lint && pnpm typecheck && pnpm test`. Fix before moving on.
5. Tick the checkbox in IMPLEMENTATION_PLAN.md, add a dated line to `docs/PROGRESS.md`.
6. Commit with Conventional Commits (`feat(capture): ...`). One task ≈ one commit.

## Style

- TypeScript strict. `<script setup lang="ts">`. Composition API only.
- Prefer Nuxt UI components + Tailwind utility classes; theme via `app.config.ts` and CSS variables.
- Server handlers stay thin; logic goes in `server/services/`.
- Dates stored as UTC `timestamptz`; display in `Africa/Lagos`.
- Phone numbers stored E.164 (`+234...`), normalised with `shared/utils/phone.ts`.
