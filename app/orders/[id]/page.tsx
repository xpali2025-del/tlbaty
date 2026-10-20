import { notFound } from 'next/navigation'
import { z } from 'zod'
import { formatPrice } from '@/lib/format'
import { getOrderWithItems } from '@/lib/queries/orders'

export const dynamic = 'force-dynamic'

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // The order id is an unguessable UUID, which also lets guests view their confirmation.
  if (!z.string().uuid().safeParse(id).success) notFound()
  const order = await getOrderWithItems(id)
  if (!order) notFound()

  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-2 text-2xl font-bold">تم استلام طلبك</h1>
      <p className="mb-4 text-sm">رقم الطلب: {order.id}</p>
      <ul className="divide-y">
        {order.items.map((i) => (
          <li key={i.id} className="flex justify-between py-2">
            <span>{i.name} × {i.qty}</span>
            <span>{formatPrice(i.unitPriceMinor * i.qty, order.currency)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 font-semibold">الإجمالي: {formatPrice(order.totalMinor, order.currency)}</p>
    </main>
  )
}
