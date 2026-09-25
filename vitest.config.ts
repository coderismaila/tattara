import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

// E2E lives in Playwright (playwright.config.ts), not Vitest.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.{test,spec}.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.{test,spec}.ts'],
          environment: 'node',
          // Tests create their own databases; keep files serial to limit connections.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['test/nuxt/**/*.{test,spec}.ts'],
          environment: 'nuxt',
          // Booting the Nuxt test app cold can take ~10 s locally (more on CI) when other projects run in parallel.
          hookTimeout: 60_000,
          testTimeout: 30_000,
          environmentOptions: {
            nuxt: {
              domEnvironment: 'happy-dom',
              overrides: {
                // The PWA client plugin imports `virtual:pwa-register/vue`, which the
                // test runtime can't resolve. No service worker is needed in unit tests.
                pwa: { disable: true, client: { registerPlugin: false } },
              },
            },
          },
        },
      }),
    ],
  },
})
