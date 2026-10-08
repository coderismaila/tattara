// Task 6.1: the stats routes are cached for 60 s in the production build (PROGRESS noted a Nitro cache-driver warning
// at build time): two calls in a row return the same computation.
import { expect, test } from '@playwright/test'
import { AUTH_STATE_FILE } from './support/env'

test.describe('stats cache (ward lead)', () => {
  test.use({ storageState: AUTH_STATE_FILE })

  for (const path of ['/api/stats/unit/19-01-01', '/api/stats/children/19-01-01?metric=supporters&sort=desc']) {
    test(`${path} is served from the cache on the second call`, async ({ request }) => {
      const first = await request.get(path)
      expect(first.status()).toBe(200)
      const second = await request.get(path)
      expect((await second.json()).computedAt).toBe((await first.json()).computedAt)
    })
  }
})
