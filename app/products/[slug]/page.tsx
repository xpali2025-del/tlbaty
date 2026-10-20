import Image from 'next/image'
import { notFound } from 'next/navigation'
import { addToCart } from '@/app/actions/cart'
import { getProductBySlug } from '@/lib/queries/products'
import { formatPrice } from '@/lib/format'
import { publicImageUrl } from '@/lib/storage/r2'

export const dynamic = 'force-dynamic'

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product || product.status !== 'active') notFound()

  return (
    <main className="mx-auto max-w-4xl p-4">
      <h1 className="text-2xl font-bold">{product.name}</h1>
      <p className="my-2 text-lg">{formatPrice(product.priceMinor, product.currency)}</p>
      <p className={product.stock > 0 ? '' : 'text-destructive'}>
        {product.stock > 0 ? 'متوفر' : 'نفد المخزون'}
      </p>
      {product.stock > 0 && (
        <form action={addToCart} className="mt-4">
          <input type="hidden" name="productId" value={product.id} />
          <button className="rounded-lg bg-primary px-4 py-2 text-primary-foreground">أضف إلى السلة</button>
        </form>
      )}
      {product.description && <p className="mt-4 whitespace-pre-line">{product.description}</p>}
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        {product.images.map((img) => (
          <Image
            key={img.id}
            src={publicImageUrl(img.objectKey)}
            alt={img.alt ?? product.name}
            width={600}
            height={600}
            className="aspect-square w-full rounded object-cover"
          />
        ))}
      </div>
    </main>
  )
}
