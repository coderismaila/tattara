# Progress Log

Newest at the top. One line per completed task: `YYYY-MM-DD · task id · summary · commit`.
Also note blockers and anything the next session must know.

## Blockers / notes for next session
- Toolchain: Node 24 (nvm-windows) + pnpm via corepack (`corepack enable pnpm`). TypeScript stays on 6.x (ADR-009).
- Compat-5 warnings (non-fatal, all modules already at latest): `unplugin-vue-i18n:resource`,
  `nuxt-fonts-public-assets` and devtools have Vite hooks ignored under the environment API. i18n verified working
  (both locales load). **0.5:** verify Noto Sans actually loads via `@nuxt/fonts` given the fonts warning.
- **0.5:** browser-language detection is off (ADR-010), so nothing persists the language yet. The language switch
  must save the choice and restore it on load (works offline, no server round-trip).
- CI workflow (`.github/workflows/ci.yml`) has not run on GitHub yet: no remote. All its steps pass locally
  (frozen install, lint, typecheck, test, build, e2e). Push to GitHub to confirm the AC "CI green".
- `pnpm install` still prints an "Ignored build scripts" notice for unrs-resolver/vue-demi despite
  `pnpm-workspace.yaml`; harmless (neither needs its script).
- Build warns that Nitro's `runtime/utils/cache-driver.mjs` can't be resolved. **6.1:** verify cached handlers
  (60 s stats cache) actually cache in a production build.
- PWA is a minimal generateSW placeholder (manifest + sw.js build fine); 4.1 replaces it with injectManifest.
- DB: `pnpm db:up && pnpm db:migrate`. Integration tests (`pnpm test:integration`) need the DB; they skip locally
  without it and fail in CI. `pg_trgm` is available but not enabled: add it in the 3.4 (search) migration.
- Hausa strings live in `i18n/locales/ha.json5` (ADR-008).

## Log
- 2026-09-25 · 0.3 · Drizzle 0.45 + postgres.js client (`createDb`, `useDb`), drizzle-kit config, migration 0000 enables PostGIS, `db:up/generate/migrate/studio`, integration test on a fresh template0 DB, PostGIS service in CI · see commit `feat(db)`
- 2026-09-25 · 0.2 · Vitest 5 (unit + nuxt projects), Playwright (Pixel 5, prod build), Husky + lint-staged + commitlint, .nvmrc 24, .gitattributes (LF), GitHub Actions CI; Hausa-always default (ADR-010) · see commit `chore(tooling)`
- 2026-09-25 · 0.1 · Nuxt 4.5.2 + compat 5, Nuxt UI 4.11.2, i18n 10.6, vite-pwa 1.1.1, nuxt-auth-utils 0.5.30, eslint, test-utils; strict TS; folder skeleton; bilingual index page · see commit `chore(scaffold)`
- 2026-09-25 · docs · Project docs created (PRD, plan, architecture, data model, API, security, UX, seed) · —
