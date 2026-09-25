// https://nuxt.com/docs/api/configuration/nuxt-config
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

  runtimeConfig: {
    databaseUrl: '',
    sms: { provider: 'fake', apiKey: '', senderId: '', webhookSecret: '' },
    // nuxt-auth-utils reads session.password (NUXT_SESSION_PASSWORD), ≥ 32 chars
    session: { password: '' },
    public: { appVersion: '', gpsFlagMeters: 3000 },
  },

  // Authenticated app routes are a client-only SPA shell (behind auth, must work offline).
  routeRules: {
    '/': { prerender: true },
    '/app/**': { ssr: false },
  },

  future: { compatibilityVersion: 5 },
  compatibilityDate: '2026-09-25',

  typescript: {
    strict: true,
    // Typecheck unit + e2e tests and the Playwright config (test/nuxt is in the app context by default).
    nodeTsConfig: {
      include: ['../test/unit/**/*', '../test/e2e/**/*', '../playwright.config.*'],
    },
  },

  eslint: {
    config: { stylistic: true },
  },

  i18n: {
    defaultLocale: 'ha',
    strategy: 'no_prefix',
    // Hausa first: never auto-switch from the phone's language (many are set to English).
    // The user's choice is persisted by the language switch (task 0.5).
    detectBrowserLanguage: false,
    locales: [
      { code: 'ha', language: 'ha-NG', name: 'Hausa', file: 'ha.json5' },
      { code: 'en', language: 'en-NG', name: 'English', file: 'en.json' },
    ],
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
      theme_color: '#0F5132',
      background_color: '#FFFFFF',
    },
  },
})
