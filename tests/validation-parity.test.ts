import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as s from '@/lib/db/store'
import { unwrapAll } from '@/lib/action-result'
import { importCatalog, loadSeedData } from '../scripts/migration/import-catalog'
import { parseAdForm } from '@/lib/validation/ad'
import { parseBrandForm, parseCategoryForm, parseCouponForm, parseReviewForm, parseSlideForm } from '@/lib/validation/catalog'
import { problemOf } from '@/lib/validation/form'
import { parseProductForm } from '@/lib/validation/product'
import { parseSettingsForm } from '@/lib/validation/settings'
import { parseUserForm } from '@/lib/validation/user'

// المرحلة 3: قاعدة التحقق واحدة في المتصفح والخادم. لكل شاشة جدول مدخلات: المحلّل نفسه الذي يستدعيه النموذج
// قبل رفع الصور، والإجراء الحقيقي في الخادم، يجب أن يتفقا في القبول والرفض وفي نص الرسالة حرفياً.

const db = drizzle(new PGlite())
vi.mock('@/lib/db/client', () => ({ db }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/manage-auth', () => ({
  assertManagePermission: async () => ({ username: 'tester', isOwner: true, permissions: [], role: 'owner' }),
  getManageUsername: () => 'odoo',
  getManageSessionUser: async () => 'tester',
}))
vi.mock('@/lib/storage/r2', () => ({ deleteImageObject: vi.fn(async () => {}) }))
vi.mock('ai', () => ({ generateText: vi.fn(async () => ({ text: 'x' })) }))

const A = unwrapAll(await import('@/app/manage/actions'))
const seed = loadSeedData(path.resolve(__dirname, '../scripts/migration/data'))

let categoryId = ''
beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') })
  await importCatalog(db, seed, { resolveImage: async (p) => p })
  categoryId = (await db.select().from(s.categories))[0].id
})

type Fields = Record<string, string | string[] | object>
type Case = { name: string; fields: () => Fields; error?: string }

const toForm = (fields: Fields) => {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, typeof v === 'string' ? v : JSON.stringify(v))
  return form
}

function parity(title: string, browser: (form: FormData) => unknown, server: (form: FormData) => Promise<unknown>, cases: Case[]) {
  describe(`${title}: browser and server agree`, () => {
    for (const c of cases) {
      it(`${c.name} → ${c.error ?? 'accepted'}`, async () => {
        const inBrowser = problemOf(() => browser(toForm(c.fields())))
        expect(inBrowser).toBe(c.error ?? null)
        if (c.error) await expect(server(toForm(c.fields()))).rejects.toThrow(c.error)
        else await expect(server(toForm(c.fields()))).resolves.not.toThrow()
      })
    }
  })
}

let n = 0
const uniq = (prefix: string) => `${prefix}${++n}`

const product = (over: Fields = {}): Fields => ({ name: uniq('منتج '), categoryId, price: '10', slug: uniq('p-'), ...over })
const colors = [{ name: 'أحمر', hex: '#FF0000' }]
parity('product', parseProductForm, (f) => A.saveProduct(null, f), [
  { name: 'valid', fields: () => product() },
  { name: 'missing name', fields: () => product({ name: ' ' }), error: 'اسم المنتج مطلوب' },
  { name: 'missing category', fields: () => product({ categoryId: '' }), error: 'اختر القسم الرئيسي للمنتج' },
  { name: 'category not a uuid', fields: () => product({ categoryId: 'abc' }), error: 'القسم غير صالح' },
  { name: 'missing price', fields: () => product({ price: '' }), error: 'أدخل سعراً صحيحاً' },
  { name: 'price not a number', fields: () => product({ price: 'abc' }), error: 'أدخل سعراً صحيحاً' },
  { name: 'negative price', fields: () => product({ price: '-1' }), error: 'السعر لا يمكن أن يكون سالباً' },
  { name: 'zero price', fields: () => product({ price: '0' }) },
  { name: 'brand not a uuid', fields: () => product({ brandId: 'zzz' }), error: 'البراند غير صالح' },
  { name: 'bad colour hex', fields: () => product({ colors: [{ name: 'أحمر', hex: 'red' }] }), error: 'لون غير صالح: الاسم مطلوب واللون بصيغة #RRGGBB' },
  { name: 'colour without name', fields: () => product({ colors: [{ name: ' ', hex: '#FF0000' }] }), error: 'لون غير صالح: الاسم مطلوب واللون بصيغة #RRGGBB' },
  { name: 'valid colour', fields: () => product({ colors }) },
  { name: 'variant colour not on product', fields: () => product({ colors, sizes: ['S'], trackVariants: 'true', variants: [{ color: 'أخضر', size: 'S', stock: 1 }] }), error: 'اللون "أخضر" ليس من ألوان المنتج' },
  { name: 'variant size not on product', fields: () => product({ colors, sizes: ['S'], trackVariants: 'true', variants: [{ color: 'أحمر', size: 'XL', stock: 1 }] }), error: 'المقاس "XL" ليس من مقاسات المنتج' },
  { name: 'variant stock negative', fields: () => product({ colors, sizes: ['S'], trackVariants: 'true', variants: [{ color: 'أحمر', size: 'S', stock: -1 }] }), error: 'كمية المخزون لكل لون/مقاس يجب أن تكون عدداً صحيحاً من 0 إلى 1,000,000' },
  { name: 'variant stock too large', fields: () => product({ colors, sizes: ['S'], trackVariants: 'true', variants: [{ color: 'أحمر', size: 'S', stock: 1_000_001 }] }), error: 'كمية المخزون لكل لون/مقاس يجب أن تكون عدداً صحيحاً من 0 إلى 1,000,000' },
  { name: 'duplicate variant', fields: () => product({ colors, sizes: ['S'], trackVariants: 'true', variants: [{ color: 'أحمر', size: 'S', stock: 1 }, { color: 'أحمر', size: 'S', stock: 2 }] }), error: 'تركيبة لون/مقاس مكررة' },
  { name: 'tracking without variants', fields: () => product({ trackVariants: 'true', variants: [] }), error: 'أضف ألواناً أو مقاسات لتتبع مخزونها، أو أوقف تتبع المخزون حسب اللون والمقاس' },
  { name: 'valid variants', fields: () => product({ colors, sizes: ['S'], trackVariants: 'true', variants: [{ color: 'أحمر', size: 'S', stock: 4 }] }) },
  { name: 'size guide chart id invalid', fields: () => product({ sizeGuide: { mode: 'chart', chartId: 'nope' } }), error: 'جدول المقاسات غير صالح' },
  { name: 'custom size guide unreadable', fields: () => product({ sizeGuide: { mode: 'custom', custom: 'x' } }), error: 'بيانات جدول المقاسات غير صالحة' },
])

parity('category', parseCategoryForm, (f) => A.saveCategory(null, f), [
  { name: 'valid', fields: () => ({ name: uniq('قسم '), slug: uniq('c-') }) },
  { name: 'missing name', fields: () => ({ name: '' }), error: 'اسم القسم مطلوب' },
  { name: 'bad code', fields: () => ({ name: uniq('قسم '), slug: uniq('c-'), code: 'D' }), error: 'رمز القسم: 2 إلى 4 أحرف إنجليزية (ورقم اختياري في الآخر)، مثل DR' },
  { name: 'code with digits only', fields: () => ({ name: uniq('قسم '), slug: uniq('c-'), code: '12' }), error: 'رمز القسم: 2 إلى 4 أحرف إنجليزية (ورقم اختياري في الآخر)، مثل DR' },
  { name: 'valid code (case-insensitive)', fields: () => ({ name: uniq('قسم '), slug: uniq('c-'), code: uniq('z').replace(/\d/g, '') + 'q' }) },
])

parity('brand', parseBrandForm, (f) => A.saveBrand(null, f), [
  { name: 'valid', fields: () => ({ name: uniq('براند '), slug: uniq('b-') }) },
  { name: 'missing name', fields: () => ({ name: '  ' }), error: 'اسم البراند مطلوب' },
])

parity('slide', parseSlideForm, (f) => A.saveSlide(null, f), [
  { name: 'missing title', fields: () => ({ title: '' }), error: 'عنوان السلايد مطلوب' },
])

parity('coupon', parseCouponForm, (f) => A.saveCoupon(null, f), [
  { name: 'valid', fields: () => ({ code: uniq('C'), discount: '10', description: 'خصم', type: 'fixed' }) },
  { name: 'missing code', fields: () => ({ discount: '10', description: 'خصم' }), error: 'كود الخصم مطلوب' },
  { name: 'missing discount', fields: () => ({ code: uniq('C'), description: 'خصم' }), error: 'قيمة الخصم مطلوبة' },
  { name: 'negative discount', fields: () => ({ code: uniq('C'), discount: '-5', description: 'خصم' }), error: 'قيمة الخصم لا يمكن أن تكون سالبة' },
  { name: 'percent over 100', fields: () => ({ code: uniq('C'), discount: '101', description: 'خصم', type: 'percent' }), error: 'نسبة الخصم لا يمكن أن تتجاوز 100%' },
  { name: 'percent exactly 100', fields: () => ({ code: uniq('C'), discount: '100', description: 'خصم', type: 'percent' }) },
  { name: 'fixed over 100 is fine', fields: () => ({ code: uniq('C'), discount: '500', description: 'خصم', type: 'fixed' }) },
  { name: 'missing description', fields: () => ({ code: uniq('C'), discount: '10' }), error: 'وصف الكوبون مطلوب' },
])

parity('review', parseReviewForm, (f) => A.saveReview(null, f), [
  { name: 'valid', fields: () => ({ name: 'سارة', comment: 'ممتاز', rating: '4', date: '2026-01-31' }) },
  { name: 'rating out of range is clamped', fields: () => ({ name: 'سارة', comment: 'ممتاز', rating: '9' }) },
  { name: 'missing name', fields: () => ({ comment: 'ممتاز' }), error: 'اسم العميل مطلوب' },
  { name: 'missing comment', fields: () => ({ name: 'سارة' }), error: 'نص التقييم مطلوب' },
  { name: 'bad date', fields: () => ({ name: 'سارة', comment: 'ممتاز', date: '31/01/2026' }), error: 'تاريخ غير صالح' },
])

parity('ad', parseAdForm, (f) => A.saveAd(null, f), [
  { name: 'missing title', fields: () => ({ title: '' }), error: 'اسم الإعلان مطلوب' },
  { name: 'bad video key', fields: () => ({ title: 'إعلان', kind: 'video', videoKey: 'https://evil.example/x.mp4' }), error: 'مفتاح الفيديو غير صالح' },
  { name: 'bad start date', fields: () => ({ title: 'إعلان', startsOn: 'غداً' }), error: 'تاريخ البداية غير صالح' },
  { name: 'bad end date', fields: () => ({ title: 'إعلان', endsOn: '2026-13-45' }), error: 'تاريخ النهاية غير صالح' },
  { name: 'end before start', fields: () => ({ title: 'إعلان', startsOn: '2026-05-10', endsOn: '2026-05-01' }), error: 'تاريخ النهاية يجب ألا يسبق تاريخ البداية' },
])

const settings = (over: Fields = {}): Fields => ({ codEnabled: 'true', ...over })
parity('settings', parseSettingsForm, (f) => A.saveSettings(null, f), [
  { name: 'valid', fields: () => settings({ phone: '+967 771 234 567', email: 'a@b.co', whatsapp: '967771234567' }) },
  { name: 'bad phone', fields: () => settings({ phone: 'abc' }), error: 'رقم الهاتف غير صالح' },
  { name: 'bad secondary phone', fields: () => settings({ secondaryPhone: '12' }), error: 'رقم الهاتف الثاني غير صالح' },
  { name: 'short whatsapp', fields: () => settings({ whatsapp: '123' }), error: 'رقم واتساب غير صالح (بالصيغة الدولية، مثل 967771234567)' },
  { name: 'bad email', fields: () => settings({ email: 'nope' }), error: 'البريد الإلكتروني غير صالح' },
  { name: 'javascript link', fields: () => settings({ instagram: 'javascript:alert(1)' }), error: 'إنستغرام: أدخل رابطاً كاملاً (https://…) أو اسم الحساب فقط' },
  { name: 'broken facebook url', fields: () => settings({ facebook: 'https://' }), error: 'رابط فيسبوك غير صالح' },
  { name: 'handle accepted', fields: () => settings({ instagram: '@my.store' }) },
  { name: 'bot number with letters', fields: () => settings({ loginBotNumber: '96777abc' }), error: 'رقم بوت الدخول: أرقام دولية فقط بلا رموز (مثل 967777000000)' },
  { name: 'unsupported login country', fields: () => settings({ loginCountriesPresent: '1', loginCountries: 'ZZ' }), error: 'دولة غير مدعومة لتسجيل الدخول' },
  { name: 'no login country', fields: () => settings({ loginCountriesPresent: '1' }), error: 'اختر دولة واحدة على الأقل لتسجيل دخول العملاء' },
  { name: 'bad otp channel', fields: () => settings({ otpChannel: 'pigeon' }), error: 'قناة إرسال رمز التحقق غير صالحة' },
  { name: 'retention too short', fields: () => settings({ proofRetentionEnabled: 'true', proofRetentionDays: '3' }), error: 'مدة الاحتفاظ بصور الإثبات: عدد صحيح من 7 إلى 365 يوماً' },
  { name: 'retention valid', fields: () => settings({ proofRetentionEnabled: 'true', proofRetentionDays: '30' }) },
  { name: 'no payment method', fields: () => ({ walletEnabled: 'true' }), error: 'فعّل طريقة دفع واحدة على الأقل، وإلا لن يستطيع العملاء إتمام الطلب' },
])

parity('user (new)', (f) => parseUserForm(f, { isNew: true }), (f) => A.saveUser(null, f), [
  { name: 'valid', fields: () => ({ username: uniq('user'), password: 'secret1', role: 'editor' }) },
  { name: 'missing username', fields: () => ({ password: 'secret1' }), error: 'اسم المستخدم مطلوب' },
  { name: 'short username', fields: () => ({ username: 'ab', password: 'secret1' }), error: 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل (أحرف/أرقام إنجليزية بدون مسافات)' },
  { name: 'username with spaces', fields: () => ({ username: 'a b c', password: 'secret1' }), error: 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل (أحرف/أرقام إنجليزية بدون مسافات)' },
  { name: 'missing password', fields: () => ({ username: uniq('user') }), error: 'كلمة المرور مطلوبة (6 أحرف على الأقل)' },
  { name: 'short password', fields: () => ({ username: uniq('user'), password: '12345' }), error: 'كلمة المرور مطلوبة (6 أحرف على الأقل)' },
])

describe('user (edit): a short new password is refused, an empty one keeps the old', () => {
  it('browser and parser agree', () => {
    const edit = (fields: Fields) => problemOf(() => parseUserForm(toForm(fields), { isNew: false }))
    expect(edit({ username: 'someone' })).toBeNull()
    expect(edit({ username: 'someone', password: '123' })).toBe('كلمة المرور يجب أن تكون 6 أحرف على الأقل')
  })
})

// القاعدة الواحدة تبقى واحدة: لا نسخة ثانية منها في الخادم، والنماذج كلها تستدعيها قبل أي رفع.
describe('single source of truth', () => {
  const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')
  const managers: [string, string][] = [
    ['products-manager', 'parseProductForm'],
    ['categories-manager', 'parseCategoryForm'],
    ['brands-manager', 'parseBrandForm'],
    ['slides-manager', 'parseSlideForm'],
    ['coupons-manager', 'parseCouponForm'],
    ['reviews-manager', 'parseReviewForm'],
    ['ads-manager', 'parseAdForm'],
    ['settings-manager', 'parseSettingsForm'],
    ['users-manager', 'parseUserForm'],
  ]
  for (const [file, parser] of managers) {
    it(`${file} validates with ${parser} before uploading images`, () => {
      const source = read(`app/manage/components/${file}.tsx`)
      expect(source).toContain(`${parser}(`)
      const check = source.indexOf('problemOf(')
      expect(check).toBeGreaterThan(-1)
      const upload = source.search(/uploadFormImages\(|uploadAdVideo\(|save[A-Z][A-Za-z]+\(/)
      // أول نداء رفع أو حفظ في النموذج يأتي بعد التحقق
      const firstCall = [...source.matchAll(/await (uploadFormImages|uploadAdVideo|save[A-Z][A-Za-z]+)\(/g)].map((m) => m.index ?? 0)
      expect(Math.min(...firstCall)).toBeGreaterThan(check)
      expect(upload).toBeGreaterThan(-1)
    })
  }

  it('the server actions no longer carry their own copy of these rules', () => {
    const actions = read('app/manage/actions.ts')
    for (const message of ['اسم المنتج مطلوب', 'اسم القسم مطلوب', 'كود الخصم مطلوب', 'رقم الهاتف غير صالح', 'اسم المستخدم مطلوب', 'تاريخ غير صالح']) {
      expect(actions).not.toContain(message)
    }
  })

  it('validation modules stay free of server-only code so the browser can import them', () => {
    for (const file of fs.readdirSync(path.resolve(__dirname, '../lib/validation'))) {
      const source = read(`lib/validation/${file}`)
      expect(source, file).not.toMatch(/server-only|from "@\/lib\/db|next\/cache|next\/server/)
    }
  })
})
