// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

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
    // NUXT_SMS_*: provider fake | termii; Termii's base URL is account-specific (dashboard).
    sms: { provider: 'fake', apiKey: '', senderId: '', baseUrl: '', webhookSecret: '' },
    // nuxt-auth-utils reads session.password (NUXT_SESSION_PASSWORD), ≥ 32 chars
    session: { password: '' },
    public: { appVersion: '', gpsFlagMeters: 3000 },
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

  // Minimal PWA config for now. Task 4.1 switches to injectManifest with a custom
  // service-worker/sw.ts, runtime caching rules and the install/update prompts.
  pwa: {
    registerType: 'prompt',
    manifest: {
      name: 'Tattara',
      short_name: 'Tattara',
      lang: 'ha',
      start_url: '/app',
      display: 'standalone',
      theme_color: '#1F3A68',
      background_color: '#F5F2EC',
    },
  },
})
