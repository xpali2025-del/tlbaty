import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { openTestDb } from './helpers/test-db'
import * as s from '@/lib/db/store'

const testDb = await openTestDb()
const db = testDb.db
const mocks = vi.hoisted(() => ({
  wa: vi.fn(async () => ({ ok: true, provider: 'whatsapp' })),
  sms: vi.fn(async () => ({ ok: true, provider: 'sms' })),
}))
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('@/lib/otp/providers/whatsapp', () => ({ whatsappProvider: { name: 'whatsapp', send: mocks.wa } }))
vi.mock('@/lib/otp/providers/sms', () => ({ smsProvider: { name: 'sms', send: mocks.sms }, isSmsConfigured: () => true }))

const { sendOtp } = await import('@/lib/otp/provider')

const input = { phone: '967771234567', code: '123456', purpose: 'login' as const }
let file: string

beforeAll(async () => {
  await testDb.migrate()
  await db.insert(s.siteSettings).values({ id: 1 })
})
beforeEach(() => {
  vi.clearAllMocks()
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'otp-sink-')), 'codes.json')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('OTP test sink', () => {
  it('writes the code per phone when OTP_TEST_SINK is set', async () => {
    vi.stubEnv('OTP_TEST_SINK', file)
    vi.stubEnv('VERCEL', '')
    expect(await sendOtp(input)).toEqual({ ok: true, provider: 'test-sink' })
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ '967771234567': '123456' })
    // الرمز الجديد لنفس الهاتف يستبدل القديم، وهاتف آخر يُضاف
    await sendOtp({ ...input, code: '654321' })
    await sendOtp({ ...input, phone: '967771234568', code: '111111' })
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ '967771234567': '654321', '967771234568': '111111' })
    expect(mocks.wa).not.toHaveBeenCalled()
    expect(mocks.sms).not.toHaveBeenCalled()
  })

  it('is inactive on Vercel even if OTP_TEST_SINK is set', async () => {
    vi.stubEnv('OTP_TEST_SINK', file)
    vi.stubEnv('VERCEL', '1')
    expect(await sendOtp(input)).toMatchObject({ ok: true, provider: 'whatsapp' })
    expect(mocks.wa).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('never active without the variable', async () => {
    vi.stubEnv('OTP_TEST_SINK', '')
    vi.stubEnv('VERCEL', '')
    expect(await sendOtp(input)).toMatchObject({ provider: 'whatsapp' })
    expect(mocks.wa).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(file)).toBe(false)
  })
})
