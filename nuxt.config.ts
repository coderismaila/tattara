// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'
import { PRECACHE_GLOBS, PRECACHE_IGNORES } from './service-worker/routes'

// nuxt-auth-utils exposes its session helpers only via Nitro auto-imports (disabled under compat 5) and its package
// exports block deep imports; this alias points at the file through the node_modules link instead (ADR-023).
const authUtilsSession = fileURLToPath(new URL('./node_modules/nuxt-auth-utils/dist/runtime/server/utils/session', import.meta.url))

export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    '@nuxt/eslint',
    '@nuxt/test-utils/module',
    '@nuxtjs/i18n',
    '@vite-pwa/nuxt',
    'nuxt-auth-utils',
  ],

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  ui: {
    // Light theme only: the palette is tuned for sunlight legibility (ADR-015).
    colorMode: false,
  },

  runtimeConfig: {
    databaseUrl: '',
    // NUXT_APP_ENV: optional override of the build-time NODE_ENV (only 'test' is meaningful: E2E on a prod build).
    appEnv: '',
    // NUXT_SMS_*: provider fake | termii; Termii's base URL is account-specific (dashboard).
    // fakeOutbox (NUXT_SMS_FAKE_OUTBOX): dev/test only, the fake provider also writes messages to this file (e2e).
    // replyNumber (NUXT_SMS_REPLY_NUMBER): two-way number supporters reply STOP to (5.2); blank = "tell your PU lead".
    // webhookSecret (NUXT_SMS_WEBHOOK_SECRET): HMAC key of the provider's webhook signature; blank = webhook off.
    sms: { provider: 'fake', apiKey: '', senderId: '', baseUrl: '', webhookSecret: '', fakeOutbox: '', replyNumber: '' },
    // nuxt-auth-utils reads session.password (NUXT_SESSION_PASSWORD), ≥ 32 chars
    session: {
      password: '',
      // h3 sessions don't slide (expiry = creation + maxAge), so the seal/cookie lives a year and requireAuth enforces
      // the real rule: 30 days since last activity, active user, same session_version, device not revoked (ADR-024).
      maxAge: 60 * 60 * 24 * 365,
      cookie: { sameSite: 'lax', httpOnly: true },
    },
    // HMAC key for OTP codes at rest (NUXT_OTP_SECRET, ≥ 32 chars).
    otpSecret: '',
    // HMAC key for opted-out phone numbers (NUXT_PHONE_HASH_SECRET, ≥ 32 chars; never change it: old opt-outs stop matching).
    phoneHashSecret: '',
    // siteUrl: base for links sent by SMS (invites), NUXT_PUBLIC_SITE_URL.
    // lockIdleMinutes: idle time before the PIN lock (SECURITY_PRIVACY §7: 5), NUXT_PUBLIC_LOCK_IDLE_MINUTES.
    public: { appVersion: '', gpsFlagMeters: 3000, siteUrl: 'http://localhost:3000', orgName: '', lockIdleMinutes: 5 },
  },

  alias: {
    '#auth-session': authUtilsSession,
  },

  // Authenticated app routes are a client-only SPA shell (behind auth, must work offline).
  routeRules: {
    '/': { prerender: true },
    '/app/**': { ssr: false },
  },

  future: { compatibilityVersion: 5 },
  compatibilityDate: '2026-09-25',

  nitro: {
    experimental: { tasks: true },
    // Cron runs in UTC; 23:55 WAT tasks (6.1) will be '55 22 * * *'.
    scheduledTasks: {
      '* * * * *': ['sms:process'],
      // 01:00 UTC = 02:00 in Lagos: the whole-registry flag scan (5.1).
      '0 1 * * *': ['flags:scan'],
      // Removal requests and STOPs are anonymised within the hour (72 h deadline, US-18).
      '15 * * * *': ['supporters:anonymise'],
    },
  },

  typescript: {
    strict: true,
    // Typecheck unit + e2e tests and the Playwright config (test/nuxt is in the app context by default).
    nodeTsConfig: {
      include: [
        '../test/unit/**/*',
        '../test/integration/**/*',
        '../test/e2e/**/*',
        '../playwright.config.*',
        '../drizzle.config.*',
        '../scripts/**/*',
      ],
      // Tests and scripts import server code, which uses these aliases; Nuxt only maps them in the app/server contexts.
      compilerOptions: {
        paths: {
          '#auth-session': ['../node_modules/nuxt-auth-utils/dist/runtime/server/utils/session'],
          '~~/*': ['../*'],
        },
      },
    },
  },

  eslint: {
    config: { stylistic: true },
  },

  // Noto Sans, self-hosted (works offline). latin-ext carries the Hausa hooked letters ɓ ɗ ƙ ƴ.
  fonts: {
    families: [
      { name: 'Noto Sans', weights: [400, 600, 700], subsets: ['latin', 'latin-ext'], global: true },
    ],
  },

  i18n: {
    defaultLocale: 'ha',
    strategy: 'no_prefix',
    // Hausa first: never auto-switch from the phone's language (many are set to English).
    // The user's choice is persisted client-side by useLanguage (app/composables/useLanguage.ts).
    detectBrowserLanguage: false,
    locales: [
      { code: 'ha', language: 'ha-NG', name: 'Hausa', file: 'ha.json5' },
      { code: 'en', language: 'en-NG', name: 'English', file: 'en.json' },
    ],
  },

  // Bundle used icons into the client so they render offline (no runtime icon API calls).
  icon: {
    clientBundle: { scan: true },
  },

  // PWA (task 4.1, ADR-034): custom service worker (service-worker/sw.ts) with Workbox. Precaches the app, serves the
  // /app shell offline, caches /geo on use, never caches /api. Updates wait for "Reload" (prompt).
  pwa: {
    strategies: 'injectManifest',
    srcDir: fileURLToPath(new URL('./service-worker', import.meta.url)),
    filename: 'sw.ts',
    registerType: 'prompt',
    injectManifest: {
      globPatterns: PRECACHE_GLOBS,
      globIgnores: PRECACHE_IGNORES,
    },
    client: {
      // Our own install card replaces Chrome's mini-infobar; "Not now" is remembered under this key.
      installPrompt: 'tattara:hideInstall',
    },
    manifest: {
      id: '/app',
      name: 'Tattara',
      short_name: 'Tattara',
      description: 'Supporter registry for polling unit, ward and LGA teams.',
      lang: 'ha',
      start_url: '/app',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      theme_color: '#1F3A68',
      background_color: '#F5F2EC',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
  },
})
