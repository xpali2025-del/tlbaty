import 'server-only'
import { and, asc, desc, eq, ilike } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { productImages, products } from '@/lib/db/schema'

const PAGE_SIZE = 24

export async function listProducts(opts: { categoryId?: string; q?: string; page?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1)
  return db
    .select()
    .from(products)
    .where(
      and(
        eq(products.status, 'active'),
        opts.categoryId ? eq(products.categoryId, opts.categoryId) : undefined,
        opts.q ? ilike(products.name, `%${opts.q.replace(/[%_]/g, '\\$&')}%`) : undefined,
      ),
    )
    .orderBy(desc(products.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
}

export async function getProductBySlug(slug: string) {
  const [product] = await db.select().from(products).where(eq(products.slug, slug)).limit(1)
  if (!product) return null
  const images = await db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, product.id))
    .orderBy(asc(productImages.sortOrder))
  return { ...product, images }
}
