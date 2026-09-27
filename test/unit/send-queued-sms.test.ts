import { beforeEach, describe, expect, it, vi } from 'vitest'

// runTask is controlled per test: each call returns a promise the test resolves by hand.
const calls: (() => void)[] = []
vi.mock('nitropack/runtime', () => ({
  runTask: vi.fn(() => new Promise<void>(resolve => calls.push(resolve))),
  useRuntimeConfig: vi.fn(),
}))

const { runTask } = await import('nitropack/runtime')
const { sendQueuedSmsNow } = await import('../../server/utils/auth-config')
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('sendQueuedSmsNow', () => {
  beforeEach(() => {
    calls.length = 0
    vi.mocked(runTask).mockClear()
  })

  it('runs the SMS task once more when messages were queued during a run', async () => {
    sendQueuedSmsNow() // first login's OTP
    sendQueuedSmsNow() // second login's OTP, queued while the first run is in flight
    sendQueuedSmsNow()
    expect(runTask).toHaveBeenCalledTimes(1)

    calls[0]!()
    await flush()
    expect(runTask).toHaveBeenCalledTimes(2) // one catch-up run, not one per call

    calls[1]!()
    await flush()
    expect(runTask).toHaveBeenCalledTimes(2)
  })

  it('starts a fresh run once the previous one has finished', async () => {
    sendQueuedSmsNow()
    calls[0]!()
    await flush()
    sendQueuedSmsNow()
    expect(runTask).toHaveBeenCalledTimes(2)
    calls[1]!()
    await flush()
  })
})
