// Signs in every caller of the access matrix (new device → OTP from the fake outbox) and creates the fixture records.
// Runs before all other E2E specs (some of those deactivate users or lock accounts).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { expect, test as setup, type APIRequestContext } from '@playwright/test'
import { newId } from '../../../shared/utils/uuid'
import { DEV_PIN, E2E_PORT, latestOtp } from '../support/env'
import { ACCESS_FIXTURE_FILE, CALLER_PHONE, callerStateFile, type Caller } from './callers'
import type { AccessFixture } from './matrix'

const BASE_URL = `http://localhost:${E2E_PORT}`
const ORIGIN = { Origin: BASE_URL }
const DEVICE_ID = '9d3e1c2a-5b4f-4a6e-8c7d-1e2f3a4b5c6d'

setup.describe.configure({ mode: 'serial' })

async function signIn(api: APIRequestContext, caller: Exclude<Caller, 'anon'>) {
  const phone = CALLER_PHONE[caller]
  const e164 = `+234${phone.slice(1)}`
  const login = await api.post('/api/auth/login', { headers: ORIGIN, data: { phone, pin: DEV_PIN, deviceId: DEVICE_ID } })
  expect(login.status(), `${caller} login`).toBe(202) // new device → OTP
  await expect.poll(() => latestOtp(e164), { message: `${caller} OTP` }).toMatch(/^\d{6}$/)
  const verify = await api.post('/api/auth/otp/verify', { headers: ORIGIN, data: { phone, code: latestOtp(e164), deviceId: DEVICE_ID } })
  expect(verify.status(), `${caller} OTP verify`).toBe(200)
  mkdirSync(dirname(callerStateFile(caller)), { recursive: true })
  await api.storageState({ path: callerStateFile(caller) })
}

setup('sign in every access-matrix caller and create the fixtures', async ({ playwright }) => {
  setup.setTimeout(120_000)
  const apis = {} as Record<Exclude<Caller, 'anon'>, APIRequestContext>
  for (const caller of Object.keys(CALLER_PHONE) as Exclude<Caller, 'anon'>[]) {
    apis[caller] = await playwright.request.newContext({ baseURL: BASE_URL })
    await signIn(apis[caller], caller)
  }

  // Four supporters on the Kano PU, captured by its lead through the real push route.
  const now = new Date().toISOString()
  const ids = Array.from({ length: 4 }, () => newId())
  const push = await apis.kanoPu.post('/api/sync/push', {
    headers: ORIGIN,
    data: { items: ids.map((id, i) => ({
      id, puCode: '19/01/01/001', fullName: `Access Fixture ${i + 1}`, phone: `+23480310080${String(i + 10)}`,
      supportLevel: 'strong', hasPvc: 'yes', consentAt: now, consentVersion: 'c1-ha', consentLanguage: 'ha', capturedAt: now,
      deviceId: DEVICE_ID,
    })) },
  })
  expect((await push.json()).results.map((r: { result: string }) => r.result)).toEqual(['accepted', 'accepted', 'accepted', 'accepted'])

  // Two invited PU leads in the Kano ward, for the deactivate / reset-PIN routes.
  const invite = async (unitCode: string, phone: string) => {
    const res = await apis.kanoWard.post('/api/team/invite', { headers: ORIGIN, data: { unitCode, fullName: 'Access Target', phone } })
    expect(res.status(), `invite ${unitCode}`).toBe(200)
    return (await res.json()).userId as string
  }

  const fixture: AccessFixture = {
    supporterView: ids[0]!,
    supporterRemovePu: ids[1]!,
    supporterRemoveWard: ids[2]!,
    supporterOther: ids[3]!,
    deactivateTarget: await invite('19/01/01/009', '08031008009'),
    resetTarget: await invite('19/01/01/010', '08031008010'),
  }
  writeFileSync(ACCESS_FIXTURE_FILE, JSON.stringify(fixture))
  for (const api of Object.values(apis)) await api.dispose()
})
