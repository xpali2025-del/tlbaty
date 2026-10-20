import Image from 'next/image'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { removeImage } from '@/app/actions/admin'
import { getProductForAdmin, listCategories } from '@/lib/queries/admin'
import { publicImageUrl } from '@/lib/storage/r2'
import { ProductForm } from '../product-form'
import { ImageUploader } from './image-uploader'

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) notFound()
  const [product, categories] = await Promise.all([getProductForAdmin(id), listCategories()])
  if (!product) notFound()

  return (
    <main className="grid gap-8 md:grid-cols-2">
      <section>
        <h1 className="mb-4 text-2xl font-bold">{product.name}</h1>
        <ProductForm product={product} categories={categories} />
      </section>
      <section>
        <h2 className="mb-4 text-xl font-bold">الصور</h2>
        <ImageUploader productId={product.id} />
        <ul className="mt-4 grid grid-cols-2 gap-3">
          {product.images.map((img) => (
            <li key={img.id}>
              <Image
                src={publicImageUrl(img.objectKey)}
                alt={img.alt ?? product.name}
                width={300}
                height={300}
                className="aspect-square w-full rounded object-cover"
              />
              <form action={removeImage}>
                <input type="hidden" name="productId" value={product.id} />
                <input type="hidden" name="imageId" value={img.id} />
                <button className="mt-1 text-sm text-destructive underline">حذف</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
