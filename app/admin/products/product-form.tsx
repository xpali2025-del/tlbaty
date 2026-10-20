'use client'
import { useActionState } from 'react'
import { saveProduct, type AdminState } from '@/app/actions/admin'

type Product = {
  id: string
  slug: string
  name: string
  description: string | null
  priceMinor: number
  currency: string
  stock: number
  status: string
  categoryId: string | null
}

const field = 'rounded border px-3 py-2'

export function ProductForm({
  product,
  categories,
}: {
  product?: Product
  categories: { id: string; name: string }[]
}) {
  const [state, action, pending] = useActionState<AdminState, FormData>(saveProduct, {})
  return (
    <form action={action} className="flex max-w-lg flex-col gap-3">
      {product && <input type="hidden" name="id" value={product.id} />}
      <input name="name" required defaultValue={product?.name} placeholder="الاسم" className={field} />
      <input
        name="slug"
        required
        dir="ltr"
        defaultValue={product?.slug}
        placeholder="slug-in-english"
        className={field}
      />
      <textarea name="description" defaultValue={product?.description ?? ''} placeholder="الوصف" rows={4} className={field} />
      <div className="flex gap-3">
        <input
          name="price"
          type="number"
          step="0.01"
          min="0"
          required
          defaultValue={product ? product.priceMinor / 100 : ''}
          placeholder="السعر"
          className={`${field} flex-1`}
        />
        <input name="currency" required maxLength={3} defaultValue={product?.currency ?? 'SAR'} className={`${field} w-24`} />
        <input name="stock" type="number" min="0" required defaultValue={product?.stock ?? 0} className={`${field} w-24`} />
      </div>
      <select name="status" defaultValue={product?.status ?? 'draft'} className={field}>
        <option value="draft">مسودة</option>
        <option value="active">نشط</option>
        <option value="archived">مؤرشف</option>
      </select>
      <select name="categoryId" defaultValue={product?.categoryId ?? ''} className={field}>
        <option value="">بدون تصنيف</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
      <button disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
        {pending ? 'جارٍ الحفظ…' : 'حفظ'}
      </button>
    </form>
  )
}
