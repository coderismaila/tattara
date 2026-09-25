import { describe, expect, it, vi } from 'vitest'
import { smsBackoffMs } from '../../server/services/sms'
import { createFakeSmsProvider } from '../../server/utils/sms/fake'
import { createTermiiProvider } from '../../server/utils/sms/termii'
import { SmsSendError, isGsm7, maskPhone } from '../../server/utils/sms/types'

const msg = { to: '+2348031234567', body: 'Your code is 123456', purpose: 'otp' as const }

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

describe('termii provider', () => {
  const opts = { apiKey: 'k', senderId: 'Tattara', baseUrl: 'https://v3.api.termii.com/' }

  it('posts the documented payload and returns the message id', async () => {
    const fetch = mockFetch(200, { code: 'ok', message_id_str: '3017544054459083819856413', message: 'Successfully Sent' })
    const result = await createTermiiProvider({ ...opts, fetch }).send(msg)

    expect(result).toEqual({ providerRef: '3017544054459083819856413' })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://v3.api.termii.com/api/sms/send')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      api_key: 'k',
      to: '2348031234567',
      from: 'Tattara',
      sms: 'Your code is 123456',
      type: 'plain',
      channel: 'dnd',
    })
  })

  it('sends Hausa hooked letters as unicode and broadcasts on the generic channel', async () => {
    const fetch = mockFetch(200, { code: 'ok', message_id: 'm1' })
    const provider = createTermiiProvider({ ...opts, fetch })
    await provider.send({ ...msg, body: 'Mun gode da goyon bayanku. Ƙungiyar ta ɗauki bayananku.', purpose: 'broadcast' })
    const payload = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(payload).toMatchObject({ type: 'unicode', channel: 'generic' })
  })

  it.each([
    [500, true],
    [503, true],
    [429, true],
    [400, false],
    [401, false],
  ])('classifies HTTP %i as retryable=%s', async (status, retryable) => {
    const provider = createTermiiProvider({ ...opts, fetch: mockFetch(status, { message: 'nope' }) })
    const error = await provider.send(msg).catch(e => e)
    expect(error).toBeInstanceOf(SmsSendError)
    expect(error.retryable).toBe(retryable)
  })

  it('treats network failures as retryable and a non-ok code as permanent', async () => {
    const fetchFails = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const down = createTermiiProvider({ ...opts, fetch: fetchFails })
    expect(await down.send(msg).catch(e => e.retryable)).toBe(true)
    const rejected = createTermiiProvider({ ...opts, fetch: mockFetch(200, { code: 'error', message: 'Invalid sender id' }) })
    expect(await rejected.send(msg).catch(e => e.retryable)).toBe(false)
  })

  it('refuses to start without credentials', () => {
    expect(() => createTermiiProvider({ ...opts, apiKey: '' })).toThrow(/NUXT_SMS_API_KEY/)
  })
})

describe('fake provider', () => {
  it('logs with a masked phone and returns a reference', async () => {
    const lines: string[] = []
    const provider = createFakeSmsProvider({ nodeEnv: 'development', log: l => lines.push(l) })
    const { providerRef } = await provider.send(msg)
    expect(providerRef).toMatch(/^fake-/)
    expect(lines).toEqual(['[sms:fake] otp → +234803****567: Your code is 123456'])
    expect(lines[0]).not.toContain('2348031234567')
  })

  it('cannot be used in production (OTPs would reach the logs)', () => {
    expect(() => createFakeSmsProvider({ nodeEnv: 'production' })).toThrow(/production/)
  })
})

describe('helpers', () => {
  it('backs off exponentially from 30 s, capped at 1 h', () => {
    expect([1, 2, 3, 4, 5].map(smsBackoffMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000])
    expect(smsBackoffMs(20)).toBe(3_600_000)
  })

  it('detects GSM-7 text', () => {
    expect(isGsm7('Sannu! Your code: 123456 (valid 10 min) €')).toBe(true)
    expect(isGsm7('Ƙara magoyi baya')).toBe(false)
    expect(isGsm7('ɗan agaji')).toBe(false)
  })

  it('masks phones', () => {
    expect(maskPhone('+2348031234567')).toBe('+234803****567')
  })
})
