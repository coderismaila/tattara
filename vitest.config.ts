import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { defineVitestProject } from '@nuxt/test-utils/config'

// Plain-Node projects resolve Nitro-only modules to stubs that fail loudly if used without a mock.
const stub = (file: string) => fileURLToPath(new URL(`./test/stubs/${file}`, import.meta.url))
const nodeAlias = {
  '#auth-session': stub('auth-session.ts'),
  'nitropack/runtime': stub('nitropack-runtime.ts'),
  // Nuxt's project-root alias, used by server code.
  '~~': fileURLToPath(new URL('.', import.meta.url)),
}

// E2E lives in Playwright (playwright.config.ts), not Vitest.
export default defineConfig({
  test: {
    // pnpm test:coverage. AC for 2.3: 100% on scope.ts.
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts', 'shared/**/*.ts'],
      exclude: ['server/db/migrations/**', '**/*.d.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: {
        'server/utils/scope.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
    projects: [
      {
        resolve: { alias: nodeAlias },
        test: {
          name: 'unit',
          include: ['test/unit/**/*.{test,spec}.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias: nodeAlias },
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
