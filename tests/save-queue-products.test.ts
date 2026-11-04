import { describe, expect, it, vi } from 'vitest'
import type { AdminBrand, AdminCategory, AdminProduct } from '@/lib/admin'
import { GENERIC_ACTION_ERROR } from '@/lib/action-result'
import { ImageUploadError } from '@/lib/storage/upload-transport'

vi.mock('@/app/manage/client-actions', () => ({ saveProduct: vi.fn() }))
const { isTransientSaveError } = await import('@/app/manage/save-queue/errors')
const { buildProductJob, optimisticProduct, rebaseProductJob, isPendingId } = await import('@/app/manage/save-queue/product-job')
const { formEntries } = await import('@/app/manage/save-queue/job-runtime')

const category = { _id: '11111111-1111-4111-8111-111111111111', name: 'فساتين', slug: 'dresses', subcategories: [] } as unknown as AdminCategory
const brand = { _id: '22222222-2222-4222-8222-222222222222', name: 'نايك' } as unknown as AdminBrand
const existing: AdminProduct = {
  _id: '33333333-3333-4333-8333-333333333333', productId: 'DR-001', name: 'قديم', price: 5, categoryId: category._id, categoryName: 'فساتين',
  images: [{ url: 'u1', ref: 'products/a.webp' }, { url: 'u2', ref: 'products/b.webp' }], image: 'main-old', stock: 3, colors: [], sizes: [], variants: [], version: 4, rating: 4.5, reviewsCount: 9, tags: ['x'],
}
const formOf = (fields: Record<string, string | File | File[]>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x)
  return f
}
const base = { name: 'جديد', categoryId: category._id, price: '12.5', slug: 'new-one' }

describe('which errors are retried', () => {
  it('retries connection, timeout, storage 5xx and the generic server error; shows everything else', () => {
    expect(isTransientSaveError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isTransientSaveError(new ImageUploadError('network', 'x'))).toBe(true)
    expect(isTransientSaveError(new ImageUploadError('timeout', 'x'))).toBe(true)
    expect(isTransientSaveError(new ImageUploadError('http', 'x', 503))).toBe(true)
    expect(isTransientSaveError(new ImageUploadError('http', 'x', 429))).toBe(true)
    expect(isTransientSaveError(new ImageUploadError('http', 'x', 403))).toBe(false)
    expect(isTransientSaveError(new Error('An unexpected response was received from the server.'))).toBe(true)
    expect(isTransientSaveError(new Error(GENERIC_ACTION_ERROR))).toBe(true)
    expect(isTransientSaveError(new Error('اسم المنتج مطلوب'))).toBe(false)
    expect(isTransientSaveError(new Error('القسم غير موجود'))).toBe(false)
  })
})

describe('the optimistic product shows what the admin just saved', () => {
  const ctx = { categories: [category], brands: [brand], entityId: existing._id }
  it('takes the edited fields, keeps the server-only ones, and the version the admin saw', () => {
    const form = formOf({ ...base, brandId: brand._id, keptImages: JSON.stringify(['products/b.webp']), stock: '7', isNew: 'true', colors: JSON.stringify([{ name: 'أحمر', hex: '#FF0000' }]) })
    const item = optimisticProduct(form, existing, ctx, { main: 'blob:main', gallery: [{ url: 'blob:g', ref: 'preview:1' }] })
    expect(item).toMatchObject({
      _id: existing._id, productId: 'DR-001', name: 'جديد', price: 12.5, categoryName: 'فساتين', categorySlug: 'dresses', brandName: 'نايك', stock: 7, isNew: true,
      image: 'blob:main', version: 4, rating: 4.5, reviewsCount: 9, tags: ['x'],
    })
    expect(item.images.map((i) => i.ref)).toEqual(['products/b.webp', 'preview:1']) // a removed image is gone, a new one previews
    expect(item.colors).toEqual([{ name: 'أحمر', hex: '#FF0000' }])
  })

  it('without a new main image the old one stays; with stock per variant the total is their sum', () => {
    const form = formOf({ ...base, colors: JSON.stringify([{ name: 'أحمر', hex: '#FF0000' }]), sizes: JSON.stringify(['S', 'M']), trackVariants: 'true', variants: JSON.stringify([{ color: 'أحمر', size: 'S', stock: 2 }, { color: 'أحمر', size: 'M', stock: 3 }]) })
    const item = optimisticProduct(form, existing, ctx, { gallery: [] })
    expect(item.image).toBe('main-old')
    expect(item.stock).toBe(5)
    expect(item.variants).toHaveLength(2)
  })

  it('a brand new product has no server fields yet', () => {
    const item = optimisticProduct(formOf(base), null, { ...ctx, entityId: 'pending-x' }, { gallery: [] })
    expect(item).toMatchObject({ _id: 'pending-x', name: 'جديد', version: 0 })
    expect(item.productId).toBeUndefined()
  })
})

describe('building the queued operation', () => {
  it('keeps the chosen files and text, drops empty file fields, and records the version for conflict detection', () => {
    const photo = new File([new Uint8Array(10)], 'a.webp', { type: 'image/webp', lastModified: 5 })
    const form = formOf({ ...base, image: new File([], ''), newImages: [photo] })
    const job = buildProductJob(form, existing, { categories: [category], brands: [brand] })
    expect(job.entityId).toBe(existing._id)
    expect(job.entries.some(([k, v]) => k === 'image' && typeof v !== 'string')).toBe(false)
    expect(job.entries.find(([k]) => k === 'newImages')?.[1]).toBe(photo)
    expect(job.entries.find(([k]) => k === 'expectedVersion')?.[1]).toBe('4')
    expect(job.label).toBe('جديد')
    expect(job.optimistic.images.at(-1)?.url).toMatch(/^blob:/)
  })

  it('a new product gets a temporary id; replacing a failed new one keeps its id', () => {
    const fresh = buildProductJob(formOf(base), null, { categories: [category], brands: [] })
    expect(isPendingId(fresh.entityId)).toBe(true)
    expect(fresh.entries.some(([k]) => k === 'expectedVersion')).toBe(false)
    const replaced = buildProductJob(formOf(base), null, { categories: [category], brands: [] }, { entityId: fresh.entityId })
    expect(replaced.entityId).toBe(fresh.entityId)
    expect(replaced.requestId).not.toBe(fresh.requestId) // changed content = a new operation
  })

  it('formEntries skips unselected file fields', () => {
    expect(formEntries(formOf({ a: 'x', f: new File([], '') }))).toEqual([['a', 'x']])
  })

  it('rebase moves a follow-up edit onto the saved version, and a follow-up of a new product onto its real id', () => {
    const next = buildProductJob(formOf(base), existing, { categories: [category], brands: [] })
    const rebased = rebaseProductJob({ ...next, state: 'queued', attempts: 0, createdAt: 1 }, { ...existing, version: 9 })
    expect(rebased.entries.filter(([k]) => k === 'expectedVersion')).toEqual([['expectedVersion', '9']])
    const pending = buildProductJob(formOf(base), null, { categories: [category], brands: [] })
    const after = rebaseProductJob({ ...pending, state: 'queued', attempts: 0, createdAt: 1 }, { ...existing, version: 1 })
    expect(after.entityId).toBe(existing._id)
    expect(after.entries.find(([k]) => k === 'expectedVersion')?.[1]).toBe('1')
  })
})
