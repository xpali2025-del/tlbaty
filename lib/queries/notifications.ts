import 'server-only'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { notifications } from '@/lib/db/schema'

export async function listUnreadNotifications(customerId: string, limit = 50) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.customerId, customerId), isNull(notifications.readAt)))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
}

export async function markNotificationRead(id: string, customerId: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.customerId, customerId), isNull(notifications.readAt)))
}
