import "server-only"
import { asc, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { isDbConfigured } from "@/lib/db-cache"
import { couriers, orders } from "@/lib/db/store"
import { resolveOptionalImageUrl } from "@/lib/images"
import { normalizeOrderStatus } from "@/lib/order-status"
import { EMPTY_COURIER_STATS, normalizeCourierStatus, type Courier, type CourierStats } from "@/lib/courier"

/** مندوبو اللوحة مع إحصاءات الطلبات المعيَّنة لكل واحد. بلا قاعدة بيانات تُرجع قائمة فارغة. */
export async function getAdminCouriers(): Promise<Courier[]> {
  if (!isDbConfigured()) return []
  try {
    const [rows, assignments] = await Promise.all([
      db.select().from(couriers).orderBy(asc(couriers.name)),
      db
        .select({
          // الربط الحي أو اللقطة المحفوظة (تبقى اللقطة إن حُذف المندوب)
          courierId: sql<string | null>`coalesce(${orders.courierSnapshot}->>'courierId', ${orders.courierId}::text)`,
          status: orders.status,
        })
        .from(orders)
        .where(sql`(${orders.courierId} is not null or ${orders.courierSnapshot}->>'courierId' is not null)`),
    ])

    const statsByCourier = new Map<string, CourierStats>()
    for (const row of assignments) {
      const id = (row.courierId ?? "").trim()
      if (!id) continue
      const stats = statsByCourier.get(id) ?? { ...EMPTY_COURIER_STATS }
      stats.assigned += 1
      const status = normalizeOrderStatus(row.status)
      if (status === "on_the_way") stats.onTheWay += 1
      if (status === "delivered") stats.delivered += 1
      if (status === "failed") stats.failed += 1
      statsByCourier.set(id, stats)
    }

    return rows.map((row) => ({
      _id: row.id,
      name: row.name.trim() || "مندوب بلا اسم",
      phone: (row.phone ?? "").trim() || undefined,
      imageUrl: resolveOptionalImageUrl(row.imageKey),
      cities: row.cities.filter(Boolean),
      status: normalizeCourierStatus(row.status),
      adminNote: row.adminNote ?? undefined,
      createdAt: row.createdAt.toISOString(),
      stats: statsByCourier.get(row.id) ?? { ...EMPTY_COURIER_STATS },
    }))
  } catch (error) {
    console.error("getAdminCouriers failed:", error instanceof Error ? error.message : "unknown")
    return []
  }
}
