import { listCategories } from '@/lib/queries/admin'
import { ProductForm } from '../product-form'

export default async function NewProduct() {
  return (
    <main>
      <h1 className="mb-4 text-2xl font-bold">منتج جديد</h1>
      <ProductForm categories={await listCategories()} />
    </main>
  )
}
