import { defineConfig, devices } from '@playwright/test'

const port = 3131
const isCI = !!process.env.CI

// E2E runs against a production build, on a low-end Android viewport.
export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  projects: [
    // Chromium only: the target is Android Chrome. Pixel 5 is the closest stock device profile.
    { name: 'android-chrome', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'pnpm build && node .output/server/index.mjs',
    url: `http://localhost:${port}`,
    reuseExistingServer: !isCI,
    timeout: 300_000,
    env: {
      PORT: String(port),
      // Test-only value; real secrets come from the deploy environment.
      NUXT_SESSION_PASSWORD: 'e2e-only-session-password-at-least-32-chars',
    },
  },
})
