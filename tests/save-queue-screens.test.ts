import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminAd, AdminCategory, AdminCoupon, AdminReview } from '@/lib/admin'

// شاشات الحفظ الفوري البسيطة: العنصر المتفائل، تسليم الرفع المسبق، وتنفيذ الحفظ بمعرّف العملية الثابت.

const calls = vi.hoisted(() => ({ save: [] as { screen: string; id: string | null; form: FormData }[] }))
const record = (screen: string) => async (id: string | null, form: FormData) => void calls.save.push({ screen, id, form })

vi.mock('@/app/manage/client-actions', () => ({
  saveCategory: record('categories'), saveBrand: record('brands'), saveSlide: record('slides'), saveCoupon: record('coupons'),
  saveReview: record('reviews'), saveAd: record('ads'), savePaymentAccount: record('payment-accounts'), saveSettings: record('settings'),
}))
vi.mock('@/lib/storage/upload-client', async (original) => ({
  ...(await original<typeof import('@/lib/storage/upload-client')>()),
  // الرفع الفعلي ليس موضوع هذا الاختبار: يضع مفتاحاً بدل الملف كما يفعل الأصلي
  uploadFormImages: vi.fn(async (form: FormData, fields: { name: string; keyName: string }[]) => {
    for (const f of fields) if (form.getAll(f.name).some((v) => v instanceof File && v.size > 0)) { form.delete(f.name); form.set(f.keyName, `uploaded/${f.name}.webp`) }
    return []
  }),
}))
const video = vi.hoisted(() => ({ upload: vi.fn(async () => 'ads/video-key.mp4'), poster: vi.fn(async () => new File([new Uint8Array(5)], 'poster.webp', { type: 'image/webp' })) }))
vi.mock('@/lib/storage/video-client', () => ({ uploadAdVideo: video.upload, extractVideoPoster: video.poster }))

const { SCREEN_SPECS, buildScreenJob, screenExecutor } = await import('@/app/manage/save-queue/screens')
const { releaseLive } = await import('@/app/manage/save-queue/job-runtime')

const formOf = (fields: Record<string, string | File>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
const photo = (name = 'a.webp') => new File([new Uint8Array(10)], name, { type: 'image/webp', lastModified: 1 })
const now = (job: ReturnType<typeof buildScreenJob>) => ({ ...job, state: 'queued' as const, attempts: 0, createdAt: 1 })

beforeEach(() => { calls.save.length = 0; video.upload.mockClear(); video.poster.mockClear() })

describe('the optimistic item of each screen', () => {
  it('category: edited fields, sub-categories, the preview of the new image, and server-only counts kept', () => {
    const existing: AdminCategory = { _id: 'c1', name: 'قديم', productCount: 7, subcategories: [], image: 'old.webp', code: 'DR' }
    const item = SCREEN_SPECS.categories.optimistic(formOf({ name: 'جديد', slug: 'new', subcategories: JSON.stringify([{ name: 'فرعي' }]) }), existing, 'c1', () => 'blob:new')
    expect(item).toMatchObject({ _id: 'c1', name: 'جديد', slug: 'new', productCount: 7, code: 'DR', image: 'blob:new' })
    expect(item.subcategories.map((s) => s.name)).toEqual(['فرعي'])
  })

  it('coupon and review follow the same parsing the server uses (uppercase code, clamped rating)', () => {
    const coupon = SCREEN_SPECS.coupons.optimistic(formOf({ code: 'save10', discount: '10', description: 'x', type: 'percent' }), null, 'pending-1', () => undefined) as AdminCoupon
    expect(coupon).toMatchObject({ _id: 'pending-1', code: 'SAVE10', type: 'percent' })
    const review = SCREEN_SPECS.reviews.optimistic(formOf({ name: 'سارة', comment: 'ممتاز', rating: '9' }), null, 'pending-2', () => undefined) as AdminReview
    expect(review.rating).toBe(5)
  })

  it('an invalid form is refused the same way the server refuses it', () => {
    expect(() => SCREEN_SPECS.coupons.optimistic(formOf({ code: 'x', discount: '-1', description: 'd' }), null, 'p', () => undefined)).toThrow('قيمة الخصم لا يمكن أن تكون سالبة')
    expect(() => SCREEN_SPECS['payment-accounts'].optimistic(formOf({ providerName: 'p' }), null, 'p', () => undefined)).toThrow('اسم صاحب الحساب مطلوب.')
  })
})

describe('building and running a queued save', () => {
  it('a new item gets a temporary id and is saved as a create with the job request id', async () => {
    const built = buildScreenJob(SCREEN_SPECS.coupons, formOf({ code: 'abc', discount: '5', description: 'd' }), null)
    expect(built.entityId.startsWith('pending-')).toBe(true)
    const result = await screenExecutor(SCREEN_SPECS.coupons).execute(now(built) as never)
    expect(result).toEqual({ status: 'saved' })
    expect(calls.save).toHaveLength(1)
    expect(calls.save[0].id).toBeNull()
    expect(calls.save[0].form.get('requestId')).toBe(built.requestId)
    releaseLive(built.id)
  })

  it('an existing item is saved as an update of its id; a retry sends the same request id', async () => {
    const existing = { _id: '11111111-1111-4111-8111-111111111111', name: 'قسم', productCount: 0, subcategories: [] } as AdminCategory
    const built = buildScreenJob(SCREEN_SPECS.categories, formOf({ name: 'قسم 2' }), existing)
    const exec = screenExecutor(SCREEN_SPECS.categories)
    await exec.execute(now(built) as never)
    await exec.execute(now(built) as never)
    expect(calls.save.map((c) => c.id)).toEqual([existing._id, existing._id])
    expect(new Set(calls.save.map((c) => c.form.get('requestId'))).size).toBe(1)
    releaseLive(built.id)
  })

  it('a chosen image becomes a key on the form before the save, and the file never reaches the action', async () => {
    const built = buildScreenJob(SCREEN_SPECS.slides, formOf({ title: 'سلايد', image: photo() }), null)
    expect(built.optimistic.image).toMatch(/^blob:/)
    await screenExecutor(SCREEN_SPECS.slides).execute(now(built) as never)
    expect(calls.save[0].form.get('imageKey')).toBe('uploaded/image.webp')
    expect(calls.save[0].form.get('image')).toBeNull()
    releaseLive(built.id)
  })

  it('a video ad: the video is uploaded and its key sent, the video file is dropped, and a cover is extracted when none was chosen', async () => {
    const file = new File([new Uint8Array(20)], 'v.mp4', { type: 'video/mp4', lastModified: 2 })
    const built = buildScreenJob(SCREEN_SPECS.ads, formOf({ title: 'إعلان', kind: 'video', video: file }), null)
    await screenExecutor(SCREEN_SPECS.ads).execute(now(built) as never)
    expect(video.upload).toHaveBeenCalledTimes(1)
    expect(video.poster).toHaveBeenCalledTimes(1)
    const sent = calls.save[0].form
    expect(sent.get('videoKey')).toBe('ads/video-key.mp4')
    expect(sent.get('video')).toBeNull()
    expect(sent.get('imageKey')).toBe('uploaded/image.webp') // the extracted cover was uploaded as the image
    releaseLive(built.id)
  })

  it('a video ad whose cover the admin chose does not extract one', async () => {
    const file = new File([new Uint8Array(20)], 'v.mp4', { type: 'video/mp4', lastModified: 3 })
    const built = buildScreenJob(SCREEN_SPECS.ads, formOf({ title: 'إعلان', kind: 'video', video: file, image: photo('cover.webp') }), null)
    await screenExecutor(SCREEN_SPECS.ads).execute(now(built) as never)
    expect(video.poster).not.toHaveBeenCalled()
    releaseLive(built.id)
  })

  it('a video ad already uploaded in advance uses that key and does not upload again', async () => {
    const file = new File([new Uint8Array(20)], 'v.mp4', { type: 'video/mp4', lastModified: 4 })
    const { PreUpload } = await import('@/lib/storage/preupload-registry')
    const pre = new PreUpload(`video|v|${file.size}|4`, file, 'ads', Promise.resolve('ads/pre-key.mp4'))
    const built = buildScreenJob(SCREEN_SPECS.ads, formOf({ title: 'إعلان', kind: 'video', video: file, image: photo('cover.webp') }), null, { extra: { videoPre: pre, posterPromise: null } })
    await screenExecutor(SCREEN_SPECS.ads).execute(now(built) as never)
    expect(video.upload).not.toHaveBeenCalled()
    expect(calls.save[0].form.get('videoKey')).toBe('ads/pre-key.mp4')
    releaseLive(built.id)
  })

  it('settings: one row, saved by its id with the logo key', async () => {
    const built = buildScreenJob(SCREEN_SPECS.settings, formOf({ codEnabled: 'true', logo: photo('logo.webp') }), { _id: 'settings' })
    expect(built.entityId).toBe('settings')
    await screenExecutor(SCREEN_SPECS.settings).execute(now(built) as never)
    expect(calls.save[0]).toMatchObject({ screen: 'settings', id: 'settings' })
    expect(calls.save[0].form.get('logoKey')).toBe('uploaded/logo.webp')
    releaseLive(built.id)
  })

  it('an ad video item keeps the old video url when only the title changes', () => {
    const existing = { _id: 'a1', title: 'قديم', kind: 'video', videoUrl: 'https://cdn/v.mp4', categoryIds: [], placements: [] } as AdminAd
    const item = SCREEN_SPECS.ads.optimistic(formOf({ title: 'جديد', kind: 'video' }), existing, 'a1', () => undefined)
    expect(item.videoUrl).toBe('https://cdn/v.mp4')
  })
})
