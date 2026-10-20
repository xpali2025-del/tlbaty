import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { customers } from '@/lib/db/schema'

export class EmailBelongsToAccountError extends Error {
  constructor() {
    super('This email belongs to a registered account; please sign in')
  }
}

type Contact = { email: string; name: string; phone?: string | null }
export type AuthIdentity = { id: string; email: string; emailConfirmed: boolean }

const byEmail = (email: string) => sql`lower(${customers.email}) = ${email.toLowerCase()}`

/**
 * Registered user: find by auth id, else claim the guest row with the same
 * (verified) email so earlier guest orders carry over, else create.
 * Guest: reuse a guest row for the email; never attach to a registered account.
 */
export async function resolveCustomer(opts: { auth?: AuthIdentity | null; contact: Contact }) {
  const { auth, contact } = opts
  const email = (auth?.email ?? contact.email).trim()

  if (auth) {
    const [existing] = await db.select().from(customers).where(eq(customers.authUserId, auth.id)).limit(1)
    if (existing) return existing
    if (auth.emailConfirmed) {
      const [claimed] = await db
        .update(customers)
        .set({ authUserId: auth.id })
        .where(and(byEmail(email), isNull(customers.authUserId)))
        .returning()
      if (claimed) return claimed
    }
    const [created] = await db
      .insert(customers)
      .values({ authUserId: auth.id, email, name: contact.name, phone: contact.phone })
      .returning()
    return created
  }

  const [row] = await db.select().from(customers).where(byEmail(email)).limit(1)
  if (row) {
    if (row.authUserId) throw new EmailBelongsToAccountError()
    // Guests may edit their contact details by checking out again with the same email.
    const [updated] = await db
      .update(customers)
      .set({ name: contact.name, phone: contact.phone })
      .where(eq(customers.id, row.id))
      .returning()
    return updated
  }
  const [created] = await db
    .insert(customers)
    .values({ email, name: contact.name, phone: contact.phone })
    .returning()
  return created
}
