import { defineConfig, devices } from '@playwright/test'
import { E2E_DB_URL, E2E_PORT, OUTBOX_FILE } from './test/e2e/support/env'

const isCI = !!process.env.CI

// E2E runs against a production build, on a low-end Android viewport, with its own database
// (recreated by global-setup.ts) and the fake SMS provider writing to an outbox file the tests read.
export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './test/e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    // Signs the app-shell user in once and saves the session (test-results/auth-state.json).
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Pixel 5'] } },
    // Chromium only: the target is Android Chrome. Pixel 5 is the closest stock device profile.
    { name: 'android-chrome', use: { ...devices['Pixel 5'] }, dependencies: ['setup'] },
  ],
  webServer: {
    // E2E_SKIP_BUILD=1 reuses an existing `pnpm build` output (the build can outlast the timeout on a busy laptop).
    command: process.env.E2E_SKIP_BUILD ? 'node .output/server/index.mjs' : 'pnpm build && node .output/server/index.mjs',
    url: `http://localhost:${E2E_PORT}`,
    // Always a fresh server: a reused one could point at another database or send real SMS.
    reuseExistingServer: false,
    // The production build takes 3–6 min on a dev laptop.
    timeout: 600_000,
    env: {
      PORT: String(E2E_PORT),
      NUXT_DATABASE_URL: E2E_DB_URL,
      // Never real SMS from tests, whatever .env says.
      NUXT_SMS_PROVIDER: 'fake',
      // The build is production; mark this run as a test environment so the fake provider may start (ADR-024).
      NUXT_APP_ENV: 'test',
      NUXT_SMS_FAKE_OUTBOX: OUTBOX_FILE,
      NUXT_PUBLIC_SITE_URL: `http://localhost:${E2E_PORT}`,
      // Test-only values; real secrets come from the deploy environment.
      NUXT_SESSION_PASSWORD: 'e2e-only-session-password-at-least-32-chars',
      NUXT_OTP_SECRET: 'e2e-only-otp-secret-at-least-32-characters',
    },
  },
})
