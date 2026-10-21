import { describe, expect, it, vi } from 'vitest'
import { createInboundHandler, toInternationalPhone } from '../worker/whatsapp/inbound.mjs'

type Msg = { body: string; from: string; fromMe?: boolean; isStatus?: boolean }
const msg = (body: string, extra: Partial<Msg> = {}): Msg => ({ body, from: '967781234567@c.us', ...extra })

function setup(opts: { claimResult?: unknown; contact?: string; now?: () => number } = {}) {
  const claim = vi.fn().mockResolvedValue(opts.claimResult ?? { ok: true, text: 'رمزك 123456' })
  const reply = vi.fn().mockResolvedValue(undefined)
  const handle = createInboundHandler({
    claim,
    reply,
    getContactNumber: async () => opts.contact ?? '967781234567',
    now: opts.now,
  })
  return { claim, reply, handle }
}

describe('toInternationalPhone', () => {
  it('accepts Yemeni and Saudi mobiles and rejects everything else', () => {
    expect(toInternationalPhone('967781234567')).toBe('967781234567')
    expect(toInternationalPhone('+966 51 234 5678')).toBe('966512345678')
    expect(toInternationalPhone('966712345678')).toBeNull() // Saudi mobiles start with 5
    expect(toInternationalPhone('967512345678')).toBeNull() // Yemeni mobiles start with 7
    expect(toInternationalPhone('971501234567')).toBeNull()
    expect(toInternationalPhone('96778123456')).toBeNull()
    expect(toInternationalPhone('781234567')).toBeNull()
    expect(toInternationalPhone(undefined)).toBeNull()
  })

  it('honours the allow-list', () => {
    expect(toInternationalPhone('966512345678', ['967'])).toBeNull()
    expect(toInternationalPhone('967781234567', ['967'])).toBe('967781234567')
  })
})

describe('inbound click-to-chat handler', () => {
  it('claims the token with the sender number and replies in the chat', async () => {
    const { claim, reply, handle } = setup()
    const m = msg('رمز الدخول: k7m2qx')
    await handle(m)
    expect(claim).toHaveBeenCalledWith({ phone: '967781234567', token: 'K7M2QX' })
    expect(reply).toHaveBeenCalledWith(m, 'رمزك 123456')
  })

  it('ignores groups, own messages, status updates, long texts and messages without a token', async () => {
    const { claim, reply, handle } = setup()
    await handle(msg('رمز الدخول: K7M2QX', { from: '1203@g.us' }))
    await handle(msg('رمز الدخول: K7M2QX', { fromMe: true }))
    await handle(msg('رمز الدخول: K7M2QX', { isStatus: true }))
    await handle(msg('رمز الدخول: K7M2QX', { from: 'status@broadcast' }))
    await handle(msg('x'.repeat(201) + ' K7M2QX'))
    await handle(msg('مرحبا، أريد الاستفسار عن منتج'))
    await handle(msg('رمز الدخول: K7M2Q'))
    expect(claim).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
  })

  it('handles Saudi senders the same way', async () => {
    const { claim, reply, handle } = setup({ contact: '966501234567' })
    await handle(msg('رمز الدخول: K7M2QX', { from: '966501234567@c.us' }))
    expect(claim).toHaveBeenCalledWith({ phone: '966501234567', token: 'K7M2QX' })
    expect(reply).toHaveBeenCalledTimes(1)
  })

  it('ignores senders from other countries without replying', async () => {
    const { claim, reply, handle } = setup({ contact: '971501234567' })
    await handle(msg('رمز الدخول: K7M2QX'))
    expect(claim).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
  })

  it('throttles repeat messages from the same sender', async () => {
    let t = 0
    const { claim, handle } = setup({ now: () => t })
    await handle(msg('رمز الدخول: K7M2QX'))
    await handle(msg('رمز الدخول: K7M2QX'))
    t += 31_000
    await handle(msg('رمز الدخول: K7M2QX'))
    expect(claim).toHaveBeenCalledTimes(2)
  })

  it('tells the customer to wait on a cooldown, and stays silent on other failures', async () => {
    const wait = setup({ claimResult: { ok: false, error: 'RESEND_TOO_SOON', retryAfter: 90 } })
    await wait.handle(msg('رمز الدخول: K7M2QX'))
    expect(wait.reply.mock.calls[0][1]).toContain('90')

    for (const result of [{ ok: false, error: 'UNKNOWN_OR_USED_TOKEN' }, { ok: false, error: 'RATE_LIMITED' }, { ok: false }]) {
      const s = setup({ claimResult: result })
      await s.handle(msg('رمز الدخول: K7M2QX'))
      expect(s.reply).not.toHaveBeenCalled()
    }
  })

  it('stays silent when the app is unreachable', async () => {
    const reply = vi.fn()
    const handle = createInboundHandler({
      claim: async () => { throw new Error('network') },
      reply,
      getContactNumber: async () => '967781234567',
    })
    await expect(handle(msg('رمز الدخول: K7M2QX'))).resolves.toBeUndefined()
    expect(reply).not.toHaveBeenCalled()
  })
})
