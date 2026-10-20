'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin'
import {
  addProductImage,
  createCategory,
  createProduct,
  deleteProductImage,
  InvalidTransitionError,
  updateOrderStatus,
  updateProduct,
  type ProductInput,
} from '@/lib/queries/admin'
import { createImageUpload, deleteImageObject, isValidImageKey } from '@/lib/storage/r2'

export type AdminState = { error?: string }

const slug = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug')
const uuid = z.string().uuid()

const productSchema = z.object({
  slug,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  price: z.coerce.number().min(0).max(10_000_000),
  currency: z.string().trim().length(3).toUpperCase(),
  stock: z.coerce.number().int().min(0).max(1_000_000),
  status: z.enum(['draft', 'active', 'archived']),
  categoryId: z.union([uuid, z.literal('')]).optional(),
})

function parseProduct(formData: FormData): ProductInput | null {
  const p = productSchema.safeParse(Object.fromEntries(formData))
  if (!p.success) return null
  return {
    slug: p.data.slug,
    name: p.data.name,
    description: p.data.description || null,
    priceMinor: Math.round(p.data.price * 100),
    currency: p.data.currency,
    stock: p.data.stock,
    status: p.data.status,
    categoryId: p.data.categoryId || null,
  }
}

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && ((e as { code?: string }).code === '23505' ||
    (e as { cause?: { code?: string } }).cause?.code === '23505')

export async function saveProduct(_: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin()
  const input = parseProduct(formData)
  if (!input) return { error: 'تحقق من الحقول (الـ slug بحروف إنجليزية صغيرة وشرطات)' }
  const id = formData.get('id')
  let savedId: string
  try {
    if (typeof id === 'string' && id) {
      const row = await updateProduct(uuid.parse(id), input)
      if (!row) return { error: 'المنتج غير موجود' }
      savedId = row.id
    } else {
      savedId = (await createProduct(input)).id
    }
  } catch (e) {
    if (isUniqueViolation(e)) return { error: 'هذا الـ slug مستخدم' }
    throw e
  }
  revalidatePath('/admin')
  redirect(`/admin/products/${savedId}`)
}

export async function saveCategory(formData: FormData) {
  await requireAdmin()
  const parsed = z
    .object({ slug, name: z.string().trim().min(1).max(100) })
    .safeParse(Object.fromEntries(formData))
  if (!parsed.success) return
  try {
    await createCategory(parsed.data.slug, parsed.data.name)
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
  }
  revalidatePath('/admin/categories')
}

export async function requestImageUpload(contentType: string, size: number) {
  await requireAdmin()
  return createImageUpload(contentType, size)
}

export async function registerImage(productId: string, objectKey: string, alt: string) {
  await requireAdmin()
  uuid.parse(productId)
  if (!isValidImageKey(objectKey)) throw new Error('Invalid image key')
  await addProductImage(productId, objectKey, alt.trim() || null)
  revalidatePath(`/admin/products/${productId}`)
}

export async function removeImage(formData: FormData) {
  await requireAdmin()
  const productId = uuid.parse(formData.get('productId'))
  const row = await deleteProductImage(uuid.parse(formData.get('imageId')), productId)
  if (row) await deleteImageObject(row.objectKey).catch(() => {})
  revalidatePath(`/admin/products/${productId}`)
}

export async function changeOrderStatus(formData: FormData) {
  await requireAdmin()
  const orderId = uuid.parse(formData.get('orderId'))
  const to = z.enum(['paid', 'shipped', 'delivered', 'cancelled']).parse(formData.get('status'))
  try {
    await updateOrderStatus(orderId, to)
  } catch (e) {
    if (!(e instanceof InvalidTransitionError)) throw e
  }
  revalidatePath('/admin/orders')
}
