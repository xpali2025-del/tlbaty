import Link from 'next/link'
import { formatPrice } from '@/lib/format'
import { listAllProducts } from '@/lib/queries/admin'

export default async function AdminProducts() {
  const items = await listAllProducts()
  return (
    <main>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">المنتجات</h1>
        <Link href="/admin/products/new" className="rounded-lg bg-primary px-3 py-2 text-primary-foreground">
          منتج جديد
        </Link>
      </div>
      <ul className="divide-y">
        {items.map((p) => (
          <li key={p.id} className="flex justify-between py-2">
            <Link className="underline" href={`/admin/products/${p.id}`}>{p.name}</Link>
            <span className="text-sm">
              {formatPrice(p.priceMinor, p.currency)} · مخزون {p.stock} · {p.status}
            </span>
          </li>
        ))}
      </ul>
    </main>
  )
}
