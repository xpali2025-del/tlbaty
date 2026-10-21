import { describe, expect, it, vi } from 'vitest'
import { createHandler } from '../worker/whatsapp/handler.mjs'

const TOKEN = 't'.repeat(32)

function call(
  handle: (req: never, res: never) => Promise<unknown>,
  opts: { method?: string; url?: string; token?: string | null; body?: unknown; raw?: string },
) {
  const raw = opts.raw ?? (opts.body === undefined ? '' : JSON.stringify(opts.body))
  const req = {
    method: opts.method ?? 'POST',
    url: opts.url ?? '/send',
    headers: opts.token === null ? {} : { authorization: `Bearer ${opts.token ?? TOKEN}` },
    async *[Symbol.asyncIterator]() {
      if (raw) yield Buffer.from(raw)
    },
  }
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const res = {
      status: 0,
      writeHead(status: number) {
        this.status = status
      },
      end(payload: string) {
        resolve({ status: this.status, body: JSON.parse(payload) })
      },
    }
    handle(req as never, res as never).catch(reject)
  })
}

const fast = { minIntervalMs: 0, jitterMs: 0, sleep: async () => {} }

describe('whatsapp worker ban protections', () => {
  const body = (phone: string) => ({ body: { phone, text: 'x' } })

  it('refuses a second message to the same recipient inside the cooldown, then allows it later', async () => {
    let t = 1_000_000
    const sendMessage = vi.fn().mockResolvedValue(undefined)
    const h = createHandler({ token: TOKEN, sendMessage, now: () => t, ...fast })
    expect((await call(h, body('967781234567'))).status).toBe(200)
    const again = await call(h, body('967781234567'))
    expect(again.status).toBe(429)
    expect(again.body).toMatchObject({ error: 'RECIPIENT_COOLDOWN' })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect((await call(h, body('967782222222'))).status).toBe(200)
    t += 61_000
    expect((await call(h, body('967781234567'))).status).toBe(200)
  })

  it('caps messages per hour and per day across recipients', async () => {
    let t = 0
    const h = createHandler({ token: TOKEN, sendMessage: async () => {}, now: () => t, maxPerHour: 3, maxPerDay: 5, ...fast })
    for (let i = 0; i < 3; i++) expect((await call(h, body(`96778000000${i}`))).status).toBe(200)
    expect((await call(h, body('967780000009'))).body).toMatchObject({ error: 'HOURLY_LIMIT' })
    t += 3_600_001
    for (let i = 0; i < 2; i++) expect((await call(h, body(`96777000000${i}`))).status).toBe(200)
    expect((await call(h, body('967770000009'))).body).toMatchObject({ error: 'DAILY_LIMIT' })
    t += 24 * 3_600_000
    expect((await call(h, body('967770000009'))).status).toBe(200)
  })

  it('pauses after repeated send failures and resumes afterwards, ignoring NOT_ON_WHATSAPP', async () => {
    let t = 0
    let mode: 'fail' | 'notOn' | 'ok' = 'notOn'
    const sendMessage = vi.fn(async () => {
      if (mode === 'fail') throw new Error('crash')
      if (mode === 'notOn') throw new Error('NOT_ON_WHATSAPP')
    })
    const h = createHandler({ token: TOKEN, sendMessage, now: () => t, breakerThreshold: 3, breakerPauseMs: 600_000, recipientCooldownMs: 0, ...fast })
    for (let i = 0; i < 5; i++) expect((await call(h, body(`96778100000${i}`))).status).toBe(422)
    mode = 'fail'
    for (let i = 0; i < 3; i++) expect((await call(h, body(`96778200000${i}`))).status).toBe(502)
    const paused = await call(h, body('967783000000'))
    expect(paused.status).toBe(503)
    expect(paused.body).toMatchObject({ error: 'PAUSED' })
    const calls = sendMessage.mock.calls.length
    t += 600_001
    mode = 'ok'
    expect((await call(h, body('967784000000'))).status).toBe(200)
    expect(sendMessage.mock.calls.length).toBe(calls + 1)
  })

  it('does not count validation failures against the limits', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined)
    const h = createHandler({ token: TOKEN, sendMessage, maxPerHour: 1, ...fast })
    for (let i = 0; i < 5; i++) expect((await call(h, body('123'))).status).toBe(400)
    expect((await call(h, body('967781234567'))).status).toBe(200)
  })
})

describe('whatsapp worker handler', () => {
  it('accepts Saudi numbers and honours a custom country allow-list', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined)
    const h = createHandler({ token: TOKEN, sendMessage, ...fast })
    expect((await call(h, { body: { phone: '966512345678', text: 'x' } })).status).toBe(200)
    expect(sendMessage).toHaveBeenCalledWith('966512345678', 'x')
    const yemenOnly = createHandler({ token: TOKEN, sendMessage, allowedCountryCodes: ['967'], ...fast })
    expect((await call(yemenOnly, { body: { phone: '966512345678', text: 'x' } })).status).toBe(400)
  })

  it('refuses to start with a short token', () => {
    expect(() => createHandler({ token: 'short', sendMessage: async () => {} })).toThrow()
  })

  it('sends to the international number as given and returns ok', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined)
    const h = createHandler({ token: TOKEN, sendMessage, ...fast })
    const res = await call(h, { body: { phone: '967781234567', text: 'رمز: 123456' } })
    expect(res).toEqual({ status: 200, body: { ok: true } })
    expect(sendMessage).toHaveBeenCalledWith('967781234567', 'رمز: 123456')
  })

  it('rejects missing or wrong tokens without sending', async () => {
    const sendMessage = vi.fn()
    const h = createHandler({ token: TOKEN, sendMessage, ...fast })
    expect((await call(h, { token: null, body: { phone: '967781234567', text: 'x' } })).status).toBe(401)
    expect((await call(h, { token: 'w'.repeat(32), body: { phone: '967781234567', text: 'x' } })).status).toBe(401)
    expect((await call(h, { token: 'short', body: { phone: '967781234567', text: 'x' } })).status).toBe(401)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('validates phone, text, JSON and body size', async () => {
    const sendMessage = vi.fn()
    const h = createHandler({ token: TOKEN, sendMessage, ...fast })
    expect((await call(h, { body: { phone: '12345', text: 'x' } })).body.error).toBe('INVALID_PHONE')
    expect((await call(h, { body: { phone: '971501234567', text: 'x' } })).body.error).toBe('INVALID_PHONE') // UAE not allowed
    expect((await call(h, { body: { phone: '781234567', text: 'x' } })).body.error).toBe('INVALID_PHONE') // bare local number
    expect((await call(h, { body: { phone: '9677812345', text: 'x' } })).status).toBe(400)
    expect((await call(h, { body: { phone: '967781234567', text: '' } })).body.error).toBe('INVALID_TEXT')
    expect((await call(h, { body: { phone: '967781234567', text: 'x'.repeat(501) } })).status).toBe(400)
    expect((await call(h, { raw: '{bad' })).status).toBe(400)
    expect((await call(h, { raw: 'x'.repeat(5000) })).status).toBe(413)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('maps sender failures and readiness to status codes', async () => {
    const notOn = createHandler({ token: TOKEN, sendMessage: async () => { throw new Error('NOT_ON_WHATSAPP') }, ...fast })
    expect(await call(notOn, { body: { phone: '967781234567', text: 'x' } })).toEqual({ status: 422, body: { ok: false, error: 'NOT_ON_WHATSAPP' } })
    const broken = createHandler({ token: TOKEN, sendMessage: async () => { throw new Error('puppeteer crashed') }, ...fast })
    expect(await call(broken, { body: { phone: '967781234567', text: 'x' } })).toEqual({ status: 502, body: { ok: false, error: 'SEND_FAILED' } })
    const sendMessage = vi.fn()
    const down = createHandler({ token: TOKEN, sendMessage, isReady: () => false, ...fast })
    expect((await call(down, { body: { phone: '967781234567', text: 'x' } })).status).toBe(503)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('serves health without a token and 404s other routes', async () => {
    const h = createHandler({ token: TOKEN, sendMessage: async () => {}, isReady: () => true, ...fast })
    expect(await call(h, { method: 'GET', url: '/health', token: null })).toEqual({ status: 200, body: { ok: true, ready: true } })
    expect((await call(h, { method: 'GET', url: '/send' })).status).toBe(404)
    expect((await call(h, { method: 'POST', url: '/other' })).status).toBe(404)
  })

  it('serialises concurrent sends with a gap between them', async () => {
    const events: string[] = []
    const sleep = vi.fn(async (ms: number) => void events.push(`sleep:${ms}`))
    const sendMessage = vi.fn(async (phone: string) => void events.push(`send:${phone}`))
    const h = createHandler({ token: TOKEN, sendMessage, sleep, minIntervalMs: 3000, jitterMs: 1000, random: () => 0.5 })
    await Promise.all([
      call(h, { body: { phone: '967781111111', text: 'a' } }),
      call(h, { body: { phone: '967782222222', text: 'b' } }),
    ])
    expect(events.slice(0, 3)).toEqual(['send:967781111111', 'sleep:3500', 'send:967782222222'])
  })

  it('never logs request bodies', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = createHandler({ token: TOKEN, sendMessage: async () => { throw new Error('x') }, ...fast })
    await call(h, { body: { phone: '967781234567', text: 'code 987654' } })
    expect([...log.mock.calls, ...err.mock.calls].flat().join(' ')).not.toContain('987654')
    log.mockRestore()
    err.mockRestore()
  })
})
