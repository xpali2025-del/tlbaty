// توزيع الطلبات على المناديب — منطق خالص بلا قاعدة بيانات (قابل للاختبار ويُستخدم في الخادم).
//
// القاعدة: لكل طلب (الأقدم أولاً) المرشَّحون هم مناديب مدينة الطلب + المناديب الذين بلا مدن محددة
// (يغطّون كل المناطق). نختار الأقل حملاً، وعند التعادل يُفضَّل مندوب المدينة على مندوب كل المناطق.
// إن لم يوجد مرشّح يُترك الطلب بلا تعيين مع سبب واضح. الحمل يزيد مع كل تعيين داخل نفس الدفعة
// فيتوزّع العدد بالتساوي بدل أن يذهب كله لمن بدأ بأقل حمل (ولا يبقى مندوب كل المناطق عاطلاً).

export type DistributionOrder = { id: string; city: string; createdAt: Date }
export type DistributionCourier = { id: string; name: string; cities: string[]; load: number }

export type SkipReason = "no_courier" | "no_city_match"

export type DistributionPlan = {
  assignments: { orderId: string; courierId: string }[]
  skipped: { orderId: string; reason: SkipReason }[]
}

const norm = (value: string) => value.trim()

export function planDistribution(orders: DistributionOrder[], couriers: DistributionCourier[]): DistributionPlan {
  const pool = couriers.map((c) => ({ ...c, cities: c.cities.map(norm).filter(Boolean) }))
  const plan: DistributionPlan = { assignments: [], skipped: [] }
  if (pool.length === 0) {
    plan.skipped = orders.map((o) => ({ orderId: o.id, reason: "no_courier" }))
    return plan
  }

  const byAge = [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
  for (const order of byAge) {
    const city = norm(order.city)
    const candidates = pool.filter((c) => c.cities.length === 0 || c.cities.includes(city))
    if (candidates.length === 0) {
      plan.skipped.push({ orderId: order.id, reason: "no_city_match" })
      continue
    }
    const specific = (c: (typeof pool)[number]) => (c.cities.length > 0 ? 0 : 1)
    const chosen = candidates.reduce((best, c) => {
      if (c.load !== best.load) return c.load < best.load ? c : best
      if (specific(c) !== specific(best)) return specific(c) < specific(best) ? c : best
      return c.name.localeCompare(best.name, "ar") < 0 ? c : best
    })
    chosen.load += 1
    plan.assignments.push({ orderId: order.id, courierId: chosen.id })
  }
  return plan
}
