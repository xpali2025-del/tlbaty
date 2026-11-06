import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { openTestDb } from './helpers/test-db'
import * as s from '@/lib/db/store'

const testDb = await openTestDb()
const db = testDb.db

const enumValues = async (typeName: string) =>
  (await db.execute(sql.raw(`select unnest(enum_range(null::store.${typeName}))::text as v`))) as unknown as { rows?: { v: string }[] } | { v: string }[]
const valuesOf = async (typeName: string) => {
  const r = await enumValues(typeName)
  const rows = Array.isArray(r) ? r : (r.rows ?? [])
  return rows.map((x) => x.v)
}
const errText = (e: unknown) => {
  const err = e as { message?: string; cause?: { message?: string } }
  return `${err.message ?? ''} ${err.cause?.message ?? ''}`
}

beforeAll(async () => {
  await testDb.migrate()
  await db.insert(s.siteSettings).values({ id: 1 })
})

describe('customer auth schema', () => {
  it('adds the new customer columns as nullable', async () => {
    const [c] = await db.insert(s.customers).values({ publicId: 'CUS_SCHEMA1', phone: '967700010001' }).returning()
    expect([c.fullName, c.email, c.passwordHash, c.deletedAt]).toEqual([null, null, null, null])
  })

  it('rejects a too short or too long full name', async () => {
    const insert = (n: number, name: string) => db.insert(s.customers).values({ publicId: `CUS_NAME${n}`, phone: `96770002000${n}`, fullName: name })
    await expect(insert(1, 'ab')).rejects.toSatisfy((e) => errText(e).includes('customers_full_name_len'))
    await expect(insert(2, 'ا'.repeat(81))).rejects.toSatisfy((e) => errText(e).includes('customers_full_name_len'))
    await expect(insert(3, 'ا'.repeat(5))).resolves.toBeDefined()
  })

  it('login_method accepts only the six keys', async () => {
    await expect(db.update(s.siteSettings).set({ loginMethod: 'telegram' })).rejects.toThrow()
    for (const key of ['wa_cloud', 'wa_web', 'sms', 'wa_web_sms', 'wa_chat', 'puk']) {
      await db.update(s.siteSettings).set({ loginMethod: key })
      expect((await db.select().from(s.siteSettings))[0].loginMethod).toBe(key)
    }
  })

  it('one live PUK per phone', async () => {
    const live = (phone: string) => ({ phone, purpose: 'recovery', codeHash: 'h', expiresAt: new Date(Date.now() + 3_600_000), createdBy: 'admin' })
    const [first] = await db.insert(s.pukCodes).values(live('967700030001')).returning()
    await expect(db.insert(s.pukCodes).values(live('967700030001'))).rejects.toSatisfy((e) => errText(e).includes('puk_codes_one_live_idx'))
    await db.update(s.pukCodes).set({ revokedAt: new Date() }).where(sql`${s.pukCodes.id} = ${first.id}`)
    await expect(db.insert(s.pukCodes).values(live('967700030001'))).resolves.toBeDefined()
  })

  it('enum values exist', async () => {
    const events = await valuesOf('auth_event_type')
    for (const v of [
      'profile_completed', 'password_set', 'password_login', 'password_failed', 'puk_requested', 'puk_issued',
      'puk_used', 'puk_failed', 'puk_revoked', 'deletion_requested', 'deletion_cancelled', 'account_deleted',
    ]) expect(events).toContain(v)
    expect(events.filter((v) => ['profile_completed', 'password_set', 'password_login', 'password_failed', 'puk_requested', 'puk_issued', 'puk_used', 'puk_failed', 'puk_revoked', 'deletion_requested', 'deletion_cancelled', 'account_deleted'].includes(v))).toHaveLength(12)
    expect(await valuesOf('customer_status')).toContain('deleted')
    expect(await valuesOf('otp_purpose')).toContain('delete_account')
  })
})
