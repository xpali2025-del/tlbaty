import { changeOrderStatus } from '@/app/actions/admin'
import { formatPrice } from '@/lib/format'
import { listOrdersForAdmin, ORDER_TRANSITIONS } from '@/lib/queries/admin'

const LABELS: Record<string, string> = {
  pending: 'قيد الانتظار',
  paid: 'مدفوع',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
}

export default async function AdminOrders() {
  const items = await listOrdersForAdmin()
  return (
    <main>
      <h1 className="mb-4 text-2xl font-bold">الطلبات</h1>
      <ul className="divide-y">
        {items.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <span>
              {o.customerName} <span dir="ltr" className="text-sm">({o.customerEmail})</span>
              <br />
              <span className="text-sm">
                {formatPrice(o.totalMinor, o.currency)} · {LABELS[o.status]} · {o.createdAt.toLocaleString('ar-SA')}
              </span>
            </span>
            <span className="flex gap-2">
              {ORDER_TRANSITIONS[o.status].map((to) => (
                <form key={to} action={changeOrderStatus}>
                  <input type="hidden" name="orderId" value={o.id} />
                  <input type="hidden" name="status" value={to} />
                  <button className="rounded border px-2 py-1 text-sm">{LABELS[to]}</button>
                </form>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </main>
  )
}
