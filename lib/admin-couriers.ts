import "server-only"

import { ordersClient } from "@/sanity/orders/client"
import { normalizeOrderStatus } from "@/lib/order-status"
import {
  EMPTY_COURIER_STATS,
  normalizeCourierStatus,
  type Courier,
  type CourierStats,
} from "@/lib/courier"

// ============================================
// طبقة قراءة المناديب للوحة الإدارة (/manage)
//
// الأداء: استعلام واحد يجلب المناديب مع فهرس خفيف لإسنادات الطلبات
// (معرّف المندوب + الحالة فقط)، ثم تُحسب الإحصائيات في الذاكرة.
// لا يوجد استعلام منفصل لكل مندوب.
// ============================================

type CourierRow = {
  _id: string
  name?: string
  phone?: string
  imageUrl?: string
  cities?: string[]
  status?: string
  adminNote?: string
  createdAt?: string
}

type AssignmentRow = {
  courierId?: string
  status?: string
}

const COURIERS_QUERY = /* groq */ `{
  "couriers": *[_type == "courier"] | order(name asc){
    _id, name, phone,
    "imageUrl": image.asset->url,
    "cities": coalesce(cities, []),
    status, adminNote, createdAt
  },
  "assignments": *[_type == "order" && (defined(courierSnapshot.courierId) || defined(courier._ref))]{
    "courierId": coalesce(courierSnapshot.courierId, courier._ref),
    status
  }
}`

/** يجلب كل المناديب مع عدد الطلبات المسندة والمنفذة وفي الطريق لكل واحد. */
export async function getAdminCouriers(): Promise<Courier[]> {
  if (!ordersClient) return []

  try {
    const result = await ordersClient.fetch<{
      couriers: CourierRow[]
      assignments: AssignmentRow[]
    }>(COURIERS_QUERY, {}, { cache: "no-store" })

    const statsByCourier = new Map<string, CourierStats>()
    for (const row of result?.assignments ?? []) {
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

    return (result?.couriers ?? []).map((row) => ({
      _id: row._id,
      name: (row.name ?? "").trim() || "مندوب بلا اسم",
      phone: (row.phone ?? "").trim() || undefined,
      imageUrl: row.imageUrl,
      cities: Array.isArray(row.cities) ? row.cities.filter(Boolean) : [],
      status: normalizeCourierStatus(row.status),
      adminNote: row.adminNote,
      createdAt: row.createdAt,
      stats: statsByCourier.get(row._id) ?? { ...EMPTY_COURIER_STATS },
    }))
  } catch (error) {
    console.error("[v0] getAdminCouriers failed:", error)
    return []
  }
}
