import Link from 'next/link'
import { inArray } from 'drizzle-orm'
import { setCartQty } from '@/app/actions/cart'
import { readCart } from '@/lib/cart'
import { db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { formatPrice } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function CartPage() {
  const cart = await readCart()
  const rows = cart.length
    ? await db.select().from(products).where(inArray(products.id, cart.map((l) => l.productId)))
    : []
  const lines = cart.flatMap((l) => {
    const p = rows.find((r) => r.id === l.productId)
    return p && p.status === 'active' ? [{ ...l, product: p }] : []
  })
  const total = lines.reduce((sum, l) => sum + l.product.priceMinor * l.qty, 0)

  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-bold">السلة</h1>
      {lines.length === 0 ? (
        <p>
          السلة فارغة. <Link className="underline" href="/products">تصفح المنتجات</Link>
        </p>
      ) : (
        <>
          <ul className="divide-y">
            {lines.map((l) => (
              <li key={l.productId} className="flex items-center justify-between gap-3 py-3">
                <span>
                  {l.product.name} · {formatPrice(l.product.priceMinor, l.product.currency)}
                </span>
                <form action={setCartQty} className="flex gap-2">
                  <input type="hidden" name="productId" value={l.productId} />
                  <input
                    name="qty"
                    type="number"
                    min={0}
                    max={99}
                    defaultValue={l.qty}
                    className="w-16 rounded border px-2 py-1"
                  />
                  <button className="underline">تحديث</button>
                </form>
              </li>
            ))}
          </ul>
          <p className="mt-4 font-semibold">
            الإجمالي: {formatPrice(total, lines[0].product.currency)}
          </p>
          <Link href="/checkout" className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-primary-foreground">
            إتمام الطلب
          </Link>
        </>
      )}
    </main>
  )
}
