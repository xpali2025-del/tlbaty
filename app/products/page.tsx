import Image from 'next/image'
import Link from 'next/link'
import { listProducts } from '@/lib/queries/products'
import { formatPrice } from '@/lib/format'
import { publicImageUrl } from '@/lib/storage/r2'
import { db } from '@/lib/db/client'
import { productImages } from '@/lib/db/schema'
import { inArray } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ q?: string; page?: string }>

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, page } = await searchParams
  const pageNum = Math.max(1, Number(page) || 1)
  const items = await listProducts({ q, page: pageNum })

  // One query for the first image of every listed product (avoids N+1).
  const images = items.length
    ? await db
        .select()
        .from(productImages)
        .where(inArray(productImages.productId, items.map((p) => p.id)))
        .orderBy(productImages.sortOrder)
    : []
  const firstImage = new Map<string, string>()
  for (const img of images) if (!firstImage.has(img.productId)) firstImage.set(img.productId, img.objectKey)

  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1 className="mb-4 text-2xl font-bold">المنتجات</h1>
      <form className="mb-6">
        <input
          name="q"
          defaultValue={q}
          placeholder="ابحث عن منتج"
          className="w-full rounded-lg border px-3 py-2"
        />
      </form>
      {items.length === 0 ? (
        <p className="text-muted-foreground">لا توجد منتجات.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {items.map((p) => {
            const key = firstImage.get(p.id)
            return (
              <li key={p.id} className="rounded-lg border p-2">
                <Link href={`/products/${p.slug}`}>
                  {key && (
                    <Image
                      src={publicImageUrl(key)}
                      alt={p.name}
                      width={400}
                      height={400}
                      className="aspect-square w-full rounded object-cover"
                    />
                  )}
                  <h2 className="mt-2 font-medium">{p.name}</h2>
                  <p className="text-sm">{formatPrice(p.priceMinor, p.currency)}</p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <nav className="mt-6 flex justify-between">
        {pageNum > 1 ? (
          <Link href={`/products?page=${pageNum - 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}>السابق</Link>
        ) : (
          <span />
        )}
        {items.length === 24 && (
          <Link href={`/products?page=${pageNum + 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}>التالي</Link>
        )}
      </nav>
    </main>
  )
}
