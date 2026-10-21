import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatPrice } from '@/lib/format'
import { findCustomerForAuth } from '@/lib/queries/customers'
import { listCustomerOrders } from '@/lib/queries/orders'
import { getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const LABELS: Record<string, string> = {
  pending: 'قيد الانتظار',
  paid: 'مدفوع',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
}

export default async function MyOrdersPage() {
  const user = await getAuthUser()
  if (!user?.email) redirect('/login')
  const customer = await findCustomerForAuth({
    id: user.id,
    email: user.email,
    emailConfirmed: !!user.email_confirmed_at,
  })
  const items = customer ? await listCustomerOrders(customer.id) : []

  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-bold">طلباتي</h1>
      {items.length === 0 ? (
        <p>
          لا توجد طلبات بعد. <Link className="underline" href="/products">تصفح المنتجات</Link>
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((o) => (
            <li key={o.id} className="flex justify-between py-3">
              <Link className="underline" href={`/orders/${o.id}`}>
                {o.createdAt.toLocaleDateString('ar-SA')} · {LABELS[o.status]}
              </Link>
              <span>{formatPrice(o.totalMinor, o.currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
