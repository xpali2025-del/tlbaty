import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@/lib/db/schema'

const db = drizzle(new PGlite(), { schema })
vi.mock('@/lib/db/client', () => ({ db }))

const { resolveCustomer, EmailBelongsToAccountError, findCustomerForAuth } = await import('@/lib/queries/customers')

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
})

describe('resolveCustomer', () => {
  it('reuses and updates a guest row for the same email (case-insensitive)', async () => {
    const a = await resolveCustomer({ contact: { email: 'Guest@x.co', name: 'Old' } })
    const b = await resolveCustomer({ contact: { email: 'guest@X.co', name: 'New', phone: '1' } })
    expect(b.id).toBe(a.id)
    expect(b.name).toBe('New')
    expect(a.authUserId).toBeNull()
  })

  it('lets a verified user claim their earlier guest row', async () => {
    const guest = await resolveCustomer({ contact: { email: 'claim@x.co', name: 'G' } })
    const auth = { id: crypto.randomUUID(), email: 'claim@x.co', emailConfirmed: true }
    const user = await resolveCustomer({ auth, contact: { email: auth.email, name: 'U' } })
    expect(user.id).toBe(guest.id)
    expect(user.authUserId).toBe(auth.id)
  })

  it('does not claim a guest row when the email is unverified', async () => {
    const guest = await resolveCustomer({ contact: { email: 'unv@x.co', name: 'G' } })
    const auth = { id: crypto.randomUUID(), email: 'unv@x.co', emailConfirmed: false }
    await expect(resolveCustomer({ auth, contact: { email: auth.email, name: 'U' } })).rejects.toThrow()
    expect(guest.authUserId).toBeNull()
  })

  it('blocks guest checkout on an email owned by a registered account', async () => {
    const auth = { id: crypto.randomUUID(), email: 'reg@x.co', emailConfirmed: true }
    await resolveCustomer({ auth, contact: { email: auth.email, name: 'R' } })
    await expect(resolveCustomer({ contact: { email: 'REG@x.co', name: 'Imposter' } })).rejects.toBeInstanceOf(
      EmailBelongsToAccountError,
    )
  })

  it('returns the same customer for a returning registered user', async () => {
    const auth = { id: crypto.randomUUID(), email: 'ret@x.co', emailConfirmed: true }
    const a = await resolveCustomer({ auth, contact: { email: auth.email, name: 'R' } })
    const b = await resolveCustomer({ auth, contact: { email: auth.email, name: 'R2' } })
    expect(b.id).toBe(a.id)
  })
})

describe('findCustomerForAuth', () => {

  it('returns null without creating a row when nothing matches', async () => {
    const before = (await db.select().from(schema.customers)).length
    const auth = { id: crypto.randomUUID(), email: 'nobody@x.co', emailConfirmed: true }
    expect(await findCustomerForAuth(auth)).toBeNull()
    expect((await db.select().from(schema.customers)).length).toBe(before)
  })

  it('claims a guest row only for a verified email', async () => {
    await resolveCustomer({ contact: { email: 'late@x.co', name: 'G' } })
    const id = crypto.randomUUID()
    expect(await findCustomerForAuth({ id, email: 'late@x.co', emailConfirmed: false })).toBeNull()
    expect((await findCustomerForAuth({ id, email: 'late@x.co', emailConfirmed: true }))?.authUserId).toBe(id)
  })
})
