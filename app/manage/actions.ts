"use server"

import { serverAction } from "@/lib/server-action"
import { parseAdForm } from "@/lib/validation/ad"
import { parseBrandForm, parseCategoryForm, parseCouponForm, parseReviewForm, parseSlideForm } from "@/lib/validation/catalog"
import { parseProductForm } from "@/lib/validation/product"
import { parseSettingsForm } from "@/lib/validation/settings"
import { parseUserForm } from "@/lib/validation/user"
import { generateText } from "ai"
import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import {
  adCategories,
  ads,
  brands,
  categories,
  coupons,
  manageUsers,
  productColors,
  productVariants,
  sizeCharts,
  productImages,
  products,
  reviews,
  siteSettings,
  slides,
  subcategories,
} from "@/lib/db/store"
import { assertManagePermission, getManageSessionUser, getManageUsername } from "@/lib/manage-auth"
import { getAdminProduct, toAdminProduct, type SaveProductResult } from "@/lib/admin"
import { createOnce, parseRequestId, withSaveRequest } from "@/lib/save-request"
import { skipUploadClaims, trackUploadKey } from "@/lib/upload-claims"
import { refreshProductSearch } from "@/lib/search-index"
import { buildSearchText } from "@/lib/search-text"
import { productsMissingPalette, refreshProductPalette } from "@/lib/product-palette"
import { normalizePermissions } from "@/lib/permissions"
import { allocateProductCode, ensureCategoryCode } from "@/lib/product-code-db"
import { isSmsConfigured } from "@/lib/otp/providers/sms"
import {
  englishSlug,
  json,
  newImageKey,
  newImageKeys,
  num,
  removeObjects,
  revalidateManage,
  revalidateStore,
  runAfterResponse,
  str,
  syncTags,
  uniqueViolation,
  uuidParam,
} from "@/lib/manage-helpers"
import { findUserByUsername, hashPassword } from "@/lib/manage-users"

// ============================================
// إجراءات لوحة الإدارة على PostgreSQL (Drizzle).
//
// التوقيعات كما كانت (المعرّف + FormData) فلا تتغير المكوّنات. الاختلاف الوحيد أن الصور
// لا تصل كملفات: يرفعها المتصفح مباشرة إلى R2 بروابط موقَّعة (lib/storage/upload-client.ts)
// وتصل هنا كمفاتيح (imageKey / newImageKeys / avatarKey / logoKey) فقط.
// عند استبدال صورة أو حذف عنصر تُحذف صورته القديمة من R2، ثم يُبطَل كاش المتجر.
// ============================================

/**
 * يولّد رابطاً (Slug) إنجليزياً مناسباً من اسم القسم واسم المنتج واسم البراند.
 * تُترجَم/تُحوّل الأسماء العربية إلى إنجليزية عبر الذكاء الاصطناعي، مع احترام
 * الأسماء الإنجليزية المعروفة للبراندات (مثل نايكي → nike).
 */
async function generateProductSlugImpl(input: {
  category?: string
  product?: string
  brand?: string
}): Promise<string> {
  await assertManagePermission("products")

  const parts = [input.category, input.product, input.brand].map((p) => (p ?? "").trim()).filter(Boolean)
  if (!parts.length) return ""

  const prompt = [
    "حوّل بيانات المنتج التالية إلى رابط (URL slug) إنجليزي قصير ونظيف.",
    "القواعد:",
    "- الناتج حروف إنجليزية صغيرة وأرقام وشرطات فقط.",
    "- ترجم المعنى العربي إلى الإنجليزية، ولا تكتب حروفاً عربية إطلاقاً.",
    "- للبراندات استخدم الاسم الإنجليزي الرسمي المعروف (مثال: نايكي → nike، أديداس → adidas).",
    "- الترتيب: القسم ثم المنتج ثم البراند، مفصولة بشرطة.",
    "- أعد السلاج فقط دون أي شرح أو علامات اقتباس.",
    "",
    input.category ? `القسم: ${input.category}` : "",
    input.product ? `المنتج: ${input.product}` : "",
    input.brand ? `البراند: ${input.brand}` : "",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const { text } = await generateText({
      model: "openai/gpt-4.1-mini",
      prompt,
    })
    const slug = englishSlug(text)
    return slug || englishSlug(parts.join("-"))
  } catch {
    return englishSlug(parts.join("-"))
  }
}

// ---------- المنتجات ----------

/** يُرمى داخل معاملة الحفظ حين تغيّر المنتج منذ فُتح النموذج: تُلغى المعاملة ويُعاد المنتج الحالي للمدير. */
class ProductConflict extends Error {}

async function saveProductImpl(id: string | null, form: FormData): Promise<SaveProductResult> {
  await assertManagePermission("products")

  const parsed = parseProductForm(form)
  const { name, categoryId, price, subSlug, brandId, slug, colors, sizeList, trackVariants, sizeChartId, customSizeChart, isNew, isBestseller, stockBase } = parsed
  const productId = id ? uuidParam(id) : null
  // معرّف العملية (يمنع التكرار عند إعادة الإرسال) ورقم النسخة التي رآها المدير عند فتح النموذج (يكشف التعارض).
  const requestId = parseRequestId(str(form, "requestId"))
  const expectedVersionRaw = num(form, "expectedVersion")
  const expectedVersion = expectedVersionRaw === undefined ? undefined : Math.trunc(expectedVersionRaw)
  const mainKey = newImageKey(form, "imageKey")
  const addedKeys = newImageKeys(form, "newImageKeys")
  const keptRefs = json<string[]>(form, "keptImages", [])
  // نتائج قراءات التحقق (القسم والقسم الفرعي والبراند وجدول المقاسات): تُقرأ داخل المعاملة مع قراءتَي القفل، فتمر الست في
  // رحلة واحدة إلى القاعدة (على اتصال المعاملة نفسه، لا اتصالات أخرى من المجمّع، فلا تعليق إن امتلأ المجمّع).
  type RefRows = [{ name: string; slug: string }[], { id: string; name: string; slug: string }[], { name: string }[], { id: string }[]]
  let category!: RefRows[0][number]
  let sub: RefRows[1][number] | undefined
  let brand: RefRows[2][number] | undefined
  let base!: ReturnType<typeof makeBase>
  const makeBase = (subcategoryId: string | null) => ({
    name,
    slug,
    description: parsed.fields.description,
    price,
    oldPrice: parsed.fields.oldPrice,
    categoryId,
    subcategoryId,
    brandId,
    stock: parsed.fields.stock,
    isNew,
    isBestseller,
    badge: parsed.fields.badge,
    sortOrder: parsed.fields.sortOrder,
    sku: parsed.fields.sku,
    metaTitle: parsed.fields.metaTitle,
    metaDescription: parsed.fields.metaDescription,
    sizes: sizeList,
    sizeChartId,
    customSizeChart,
    keywords: parsed.fields.keywords,
    updatedAt: new Date(),
  })

  const removed: (string | null)[] = []
  const nextVariants = trackVariants ? parsed.variants : null
  const searchText = (code: string, tags: string[]) =>
    buildSearchText({
      name,
      description: base.description,
      code,
      sku: base.sku,
      category: category.name,
      subcategory: sub?.name ?? null,
      brand: brand?.name ?? null,
      colors: colors.map((c) => c.name),
      sizes: sizeList,
      tags,
      keywords: base.keywords,
    })
  // معرّف المنتج يُحدَّد قبل المعاملة (الجديد بـ UUID نولّده هنا) فيُسجَّل مع معرّف العملية بجملة واحدة.
  const entityId = productId ?? crypto.randomUUID()
  let outcome: Awaited<ReturnType<typeof withSaveRequest<SavedProduct>>>
  try {
    // كل جملة داخل المعاملة ذهاب وإياب للقاعدة، فنقلّل عددها: لا نعيد كتابة الصور والألوان إن لم تتغيّر،
    // ومخزون المتغيّرات بجملة واحدة، ونص البحث يُحسب هنا، والصف المحفوظ يعود من جملة الحفظ نفسها (returning).
    outcome = await withSaveRequest(requestId, "products", entityId, async (tx): Promise<SavedProduct> => {
      let existingKeys: string[] = []
      let sameColors = false
      // المتغيّرات تُقفل قبل المنتج، بنفس ترتيب إنشاء الطلب (متغيّرات ← منتج) فلا يتعارض الحفظ مع طلب متزامن.
      // القراءتان تُرسلان معاً (تُنفَّذان في الخادم بترتيب الإرسال نفسه) فتوفّران ذهاباً وإياباً.
      const refReads = Promise.all([
        tx.select({ name: categories.name, slug: categories.slug }).from(categories).where(eq(categories.id, categoryId)).limit(1),
        subSlug
          ? tx
              .select({ id: subcategories.id, name: subcategories.name, slug: subcategories.slug })
              .from(subcategories)
              .where(and(eq(subcategories.categoryId, categoryId), eq(subcategories.slug, subSlug)))
              .limit(1)
          : Promise.resolve([]),
        brandId ? tx.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId)).limit(1) : Promise.resolve([]),
        sizeChartId ? tx.select({ id: sizeCharts.id }).from(sizeCharts).where(eq(sizeCharts.id, sizeChartId)).limit(1) : Promise.resolve([]),
      ])
      const [refs, [lockedVariants, [existing]]] = await Promise.all([
        refReads,
        productId
          ? Promise.all([
              tx.select().from(productVariants).where(eq(productVariants.productId, productId)).for("update"),
              tx
                .select({
                  tags: products.tags,
                  mainImageKey: products.mainImageKey,
                  productNumber: products.productNumber,
                  version: products.version,
                  imageKeys: sql<string[]>`coalesce((select array_agg(${productImages.imageKey} order by ${productImages.sortOrder}, ${productImages.id}) from ${productImages} where ${productImages.productId} = ${productId}), '{}')`,
                  colors: sql<{ name: string; hex: string }[]>`coalesce((select json_agg(json_build_object('name', ${productColors.name}, 'hex', ${productColors.hex}) order by ${productColors.sortOrder}, ${productColors.id}) from ${productColors} where ${productColors.productId} = ${productId}), '[]')`,
                })
                .from(products)
                .where(eq(products.id, productId))
                .for("update"),
            ])
          : Promise.resolve([[], []] as [never[], never[]]),
      ])
      const [[c], [s], [b], [chart]] = refs as RefRows
      if (!c) throw new Error("القسم غير موجود")
      if (brandId && !b) throw new Error("البراند غير موجود")
      if (sizeChartId && !chart) throw new Error("جدول المقاسات المختار غير موجود")
      category = c
      sub = s
      brand = b
      base = makeBase(s?.id ?? null)
      const applied = applyVariantStock(lockedVariants, nextVariants)
      const stock = applied?.total ?? null
      let row: typeof products.$inferSelect
      if (productId) {
        if (!existing) throw new Error("المنتج غير موجود")
        if (expectedVersion !== undefined && existing.version !== expectedVersion) throw new ProductConflict()
        existingKeys = existing.imageKeys
        sameColors = existing.colors.length === colors.length && existing.colors.every((c, i) => c.name === colors[i].name && c.hex === colors[i].hex)
        const tags = syncTags(existing.tags, { isNew, isBestseller })
        ;[row] = await tx
          .update(products)
          .set({
            ...base,
            // المخزون يُطبَّق كفرق عمّا رآه المدير عند فتح النموذج، لا كقيمة مطلقة: وإلا مسح حفظ تعديل سعر
            // خصم الطلبات التي جرت أثناء فتح النموذج وسمح ببيع ما نفد. المتتبَّع لكل لون/مقاس = مجموع متغيّراته.
            stock: stock ?? (stockBase === undefined ? base.stock : sql`greatest(0, ${products.stock} + ${base.stock - stockBase})`),
            tags,
            searchText: searchText(existing.productNumber, tags),
            version: sql`${products.version} + 1`,
            ...(mainKey ? { mainImageKey: mainKey } : {}),
          })
          .where(eq(products.id, productId))
          .returning()
        if (mainKey && existing.mainImageKey !== mainKey) removed.push(existing.mainImageKey)
      } else {
        // رمز قصير بالتسلسل داخل القسم (مثل DR-012)، يُحجز ذرياً فلا يتكرر.
        const productNumber = await allocateProductCode(tx, categoryId)
        ;[row] = await tx
          .insert(products)
          .values({
            ...base,
            id: entityId,
            stock: stock ?? base.stock,
            productNumber,
            rating: 5,
            reviewsCount: 0,
            tags: [],
            searchText: searchText(productNumber, []),
            mainImageKey: mainKey ?? null,
          })
          .returning()
      }

      // نثق فقط بالمراجع التي ما زالت موجودة فعلاً في معرض المنتج؛ أي مرجع غريب يُتجاهل.
      const kept = keptRefs.filter((k) => existingKeys.includes(k))
      removed.push(...existingKeys.filter((k) => !kept.includes(k)))
      const gallery = [...kept, ...addedKeys]
      const sameGallery = gallery.length === existingKeys.length && gallery.every((k, i) => k === existingKeys[i])
      if (!sameGallery) {
        if (existingKeys.length) await tx.delete(productImages).where(eq(productImages.productId, entityId))
        if (gallery.length) await tx.insert(productImages).values(gallery.map((imageKey, i) => ({ productId: entityId, imageKey, sortOrder: i })))
      }
      if (!sameColors) {
        if (productId) await tx.delete(productColors).where(eq(productColors.productId, entityId))
        if (colors.length) await tx.insert(productColors).values(colors.map((c, i) => ({ productId: entityId, name: c.name, hex: c.hex, sortOrder: i })))
      }
      await saveVariantStock(tx, entityId, lockedVariants, applied?.rows ?? null)
      return { row, gallery, variants: (applied?.rows ?? []).map(({ color, size, stock }) => ({ color, size, stock })) }
    })
  } catch (e) {
    if (e instanceof ProductConflict && productId) {
      skipUploadClaims() // الصور المرفوعة لم تُستعمل: تبقى معلّقة فيعيد المدير المحاولة أو ينظّفها التنظيف
      return { status: "conflict", current: await getAdminProduct(productId) }
    }
    const constraint = uniqueViolation(e)
    if (constraint?.includes("slug")) throw new Error("هذا الرابط (slug) مستخدم لمنتج آخر، اختر رابطاً مختلفاً")
    if (constraint !== null) throw new Error("تعذّر الحفظ بسبب تعارض في البيانات")
    throw e
  }

  // إعادة إرسال لعملية حُفظت سابقاً: لا آثار جانبية ثانية (حذف صور، بصمة ألوان، إبطال كاش)، والكيان هو الأول.
  if (outcome.replayed) {
    if (productId && productId !== outcome.entityId) throw new Error("معرّف عملية الحفظ مستخدم لمنتج آخر")
    const item = await getAdminProduct(outcome.entityId)
    if (!item) throw new Error("المنتج لم يعد موجوداً")
    return { status: "saved", item, replayed: true }
  }

  // إبطال كاش المتجر بعد إرسال الرد: لا ينتظره المدير، والقائمة تتحدّث من العنصر المعاد لا من إعادة رسم الصفحة.
  await runAfterResponse(async () => revalidateStore())
  // أعمال غير حرجة بعد الرد: حذف الصور القديمة (removeObjects يؤجّل نفسه)، وبصمة الألوان للبحث بالصورة
  // (قراءة من R2 + معالجة) عند صورة رئيسية جديدة.
  await removeObjects(removed)
  if (mainKey) await runAfterResponse(() => refreshProductPalette(entityId, mainKey).catch(() => false))

  // العنصر المعاد بشكل القائمة من بيانات الحفظ نفسها (لا قراءة إضافية من القاعدة).
  const saved = outcome.value
  const item = toAdminProduct(saved.row, {
    categoryName: category.name,
    categorySlug: category.slug,
    subcategorySlug: sub?.slug,
    brandName: brand?.name,
    images: saved.gallery,
    colors,
    variants: saved.variants,
  })
  return { status: "saved", item, replayed: false }
}

/** ما تعيده معاملة حفظ المنتج: الصف المحفوظ، ومعرض صوره بترتيبه، ومخزون متغيّراته النهائي. */
type SavedProduct = {
  row: typeof products.$inferSelect
  gallery: string[]
  variants: { color: string; size: string; stock: number }[]
}

type VariantInput = { color: string; size: string; stock: number; base: number | undefined }
type VariantRow = typeof productVariants.$inferSelect

/**
 * مخزون كل تركيبة بعد الحفظ. كالمخزون الواحد، يُطبَّق كفرق عمّا رآه المدير عند فتح النموذج (base)
 * فلا يمسح الحفظ خصم طلبات جرت أثناء فتح النموذج؛ التركيبة الجديدة تأخذ القيمة المدخلة.
 * يعيد المخزون النهائي لكل تركيبة ومجموعها (= products.stock للمنتج المتتبَّع)، أو null إن لم يكن التتبع مفعّلاً.
 * الصفوف مقفلة (FOR UPDATE) فالمجموع المحسوب هنا هو ما سيُحفظ.
 */
function applyVariantStock(locked: VariantRow[], next: VariantInput[] | null): { total: number; rows: VariantInput[] } | null {
  if (next === null) return null
  const existing = new Map(locked.map((v) => [`${v.color}\u0000${v.size}`, v]))
  const rows = next.map((v) => {
    const row = existing.get(`${v.color}\u0000${v.size}`)
    return { ...v, stock: row && v.base !== undefined ? Math.max(0, row.stock + (v.stock - v.base)) : v.stock }
  })
  return { total: rows.reduce((sum, v) => sum + v.stock, 0), rows }
}

/**
 * يكتب مخزون ألوان/مقاسات المنتج (بعد applyVariantStock): تركيبة واحدة أو مئة بجملة واحدة، والمحذوفة بجملة.
 * `null` = إيقاف التتبع (حذف المتغيّرات والعودة للمخزون الواحد).
 */
async function saveVariantStock(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  productId: string,
  locked: VariantRow[],
  next: VariantInput[] | null,
) {
  const keep = new Set((next ?? []).map((v) => `${v.color}\u0000${v.size}`))
  const gone = locked.filter((v) => !keep.has(`${v.color}\u0000${v.size}`)).map((v) => v.id)
  if (gone.length) await tx.delete(productVariants).where(inArray(productVariants.id, gone))
  if (next?.length) {
    await tx
      .insert(productVariants)
      .values(next.map((v) => ({ productId, color: v.color, size: v.size, stock: v.stock })))
      .onConflictDoUpdate({ target: [productVariants.productId, productVariants.color, productVariants.size], set: { stock: sql`excluded.stock` } })
  }
}

/** تعبئة بصمات الألوان للمنتجات القائمة (صورها موجودة وبلا بصمة) — دفعة من 40 في كل نداء. */
async function backfillImagePalettesImpl(): Promise<{ done: number; remaining: number }> {
  await assertManagePermission("products")
  const batch = await productsMissingPalette(40)
  let done = 0
  for (const p of batch) if (await refreshProductPalette(p.id, p.imageKey).catch(() => false)) done++
  const [{ n }] = await db.select({ n: count() }).from(products).where(and(isNotNull(products.mainImageKey), sql`${products.imagePalette} = '[]'::jsonb`))
  return { done, remaining: Number(n) }
}

async function deleteProductImpl(id: string) {
  await assertManagePermission("products")
  const productId = uuidParam(id)
  const [existing] = await db.select().from(products).where(eq(products.id, productId)).limit(1)
  if (!existing) return
  const gallery = await db.select().from(productImages).where(eq(productImages.productId, productId))
  await db.delete(products).where(eq(products.id, productId))
  revalidateStore()
  await removeObjects([existing.mainImageKey, ...gallery.map((g) => g.imageKey)])
}

async function toggleProductFlagImpl(id: string, field: "isNew" | "isBestseller", value: boolean) {
  await assertManagePermission("products")
  if (field !== "isNew" && field !== "isBestseller") throw new Error("حقل غير مدعوم")
  const productId = uuidParam(id)
  const [existing] = await db.select().from(products).where(eq(products.id, productId)).limit(1)
  if (!existing) throw new Error("المنتج غير موجود")
  await db
    .update(products)
    .set({ [field]: value, tags: syncTags(existing.tags, { [field]: value }), updatedAt: new Date(), version: sql`${products.version} + 1` })
    .where(eq(products.id, productId))
  revalidateStore()
}

// ---------- الأقسام ----------

async function saveCategoryImpl(id: string | null, form: FormData) {
  await assertManagePermission("categories")

  const parsed = parseCategoryForm(form)
  const categoryId = id ? uuidParam(id) : null
  const imageKey = newImageKey(form, "imageKey")
  const { subcategories: incoming, ...fields } = parsed
  const values = { ...fields, updatedAt: new Date() }
  // معرّف العملية: إعادة إرسال إنشاء وصل ثم ضاع ردّه لا تُنشئ قسماً ثانياً (ولا تُرفض كرابط مكرر).
  const requestId = parseRequestId(str(form, "requestId"))
  const entityId = categoryId ?? crypto.randomUUID()

  let oldImage: string | null = null
  try {
    await withSaveRequest(requestId, "categories", entityId, async (tx) => {
      let rowId: string
      // نص بحث المنتجات يحمل اسم القسم وأسماء أقسامه الفرعية: لا يُعاد بناؤه إلا إن تغيّر أحدها.
      let searchTextStale = false
      if (categoryId) {
        const [existing] = await tx.select().from(categories).where(eq(categories.id, categoryId)).limit(1)
        if (!existing) throw new Error("القسم غير موجود")
        await tx.update(categories).set({ ...values, ...(imageKey ? { imageKey } : {}) }).where(eq(categories.id, categoryId))
        if (imageKey && existing.imageKey !== imageKey) oldImage = existing.imageKey
        searchTextStale = existing.name !== values.name
        rowId = categoryId
      } else {
        ;[{ id: rowId }] = await tx.insert(categories).values({ id: entityId, ...values, imageKey: imageKey ?? null }).returning({ id: categories.id })
      }
      await ensureCategoryCode(tx, rowId)

      const current = await tx.select().from(subcategories).where(eq(subcategories.categoryId, rowId))
      const stale = current.filter((c) => !incoming.has(c.slug)).map((c) => c.id)
      if (stale.length) {
        await tx.delete(subcategories).where(inArray(subcategories.id, stale))
        searchTextStale = true // منتجات القسم الفرعي المحذوف تفقد اسمه
      }
      const currentNames = new Map(current.map((c) => [c.slug, c.name]))
      for (const [slug, sub] of incoming) if (currentNames.has(slug) && currentNames.get(slug) !== sub.name) searchTextStale = true
      // كل الأقسام الفرعية بجملة واحدة (جملة لكل قسم فرعي = ذهاب وإياب لكل منها).
      const subRows = [...incoming].map(([slug, sub], order) => ({ categoryId: rowId, slug, name: sub.name, description: sub.description, sortOrder: order }))
      if (subRows.length) {
        await tx
          .insert(subcategories)
          .values(subRows)
          .onConflictDoUpdate({
            target: [subcategories.categoryId, subcategories.slug],
            set: { name: sql`excluded.name`, description: sql`excluded.description`, sortOrder: sql`excluded.sort_order` },
          })
      }
      if (categoryId && searchTextStale) await refreshProductSearch(tx, { categoryId: rowId })
    })
  } catch (e) {
    const constraint = uniqueViolation(e)
    if (constraint?.includes("code")) throw new Error("رمز القسم مستخدم لقسم آخر، اختر رمزاً مختلفاً")
    if (constraint !== null) throw new Error("هذا الرابط (slug) مستخدم لقسم آخر، اختر رابطاً مختلفاً")
    throw e
  }

  revalidateStore()
  await removeObjects([oldImage])
}

async function deleteCategoryImpl(id: string) {
  await assertManagePermission("categories")
  const categoryId = uuidParam(id)
  const [{ n }] = await db.select({ n: count() }).from(products).where(eq(products.categoryId, categoryId))
  if (n > 0) {
    throw new Error(`لا يمكن حذف القسم لوجود ${n} منتج مرتبط به. انقل المنتجات أولاً.`)
  }
  const [existing] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1)
  if (!existing) return
  await db.delete(categories).where(eq(categories.id, categoryId))
  revalidateStore()
  await removeObjects([existing.imageKey])
}

// ---------- الماركات ----------

async function saveBrandImpl(id: string | null, form: FormData) {
  await assertManagePermission("brands")

  const parsed = parseBrandForm(form)
  const brandId = id ? uuidParam(id) : null
  const imageKey = newImageKey(form, "imageKey")
  const values = { ...parsed, updatedAt: new Date() }

  let oldImage: string | null = null
  try {
    if (brandId) {
      const [existing] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1)
      if (!existing) throw new Error("البراند غير موجود")
      await db.update(brands).set({ ...values, ...(imageKey ? { imageKey } : {}) }).where(eq(brands.id, brandId))
      if (existing.name !== values.name) await refreshProductSearch(db, { brandId })
      if (imageKey && existing.imageKey !== imageKey) oldImage = existing.imageKey
    } else {
      await createOnce(parseRequestId(str(form, "requestId")), "brands", (tx, rowId) => tx.insert(brands).values({ id: rowId, ...values, imageKey: imageKey ?? null }).then(() => {}))
    }
  } catch (e) {
    if (uniqueViolation(e) !== null) throw new Error("هذا الرابط (slug) مستخدم لبراند آخر، اختر رابطاً مختلفاً")
    throw e
  }

  revalidateStore()
  await removeObjects([oldImage])
}

async function deleteBrandImpl(id: string) {
  await assertManagePermission("brands")
  const brandId = uuidParam(id)
  const [existing] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!existing) return
  await db.delete(brands).where(eq(brands.id, brandId))
  revalidateStore()
  await removeObjects([existing.imageKey])
}

// ---------- السلايدر ----------

async function saveSlideImpl(id: string | null, form: FormData) {
  await assertManagePermission("slides")

  const parsed = parseSlideForm(form)
  const slideId = id ? uuidParam(id) : null
  const imageKey = newImageKey(form, "imageKey")
  const values = { ...parsed, updatedAt: new Date() }

  let oldImage: string | null = null
  if (slideId) {
    const [existing] = await db.select().from(slides).where(eq(slides.id, slideId)).limit(1)
    if (!existing) throw new Error("الشريحة غير موجودة")
    await db.update(slides).set({ ...values, ...(imageKey ? { imageKey } : {}) }).where(eq(slides.id, slideId))
    if (imageKey && existing.imageKey !== imageKey) oldImage = existing.imageKey
  } else {
    if (!imageKey) throw new Error("صورة السلايد مطلوبة")
    await createOnce(parseRequestId(str(form, "requestId")), "slides", (tx, rowId) => tx.insert(slides).values({ id: rowId, ...values, imageKey }).then(() => {}))
  }

  revalidateStore()
  await removeObjects([oldImage])
}

async function deleteSlideImpl(id: string) {
  await assertManagePermission("slides")
  const slideId = uuidParam(id)
  const [existing] = await db.select().from(slides).where(eq(slides.id, slideId)).limit(1)
  if (!existing) return
  await db.delete(slides).where(eq(slides.id, slideId))
  revalidateStore()
  await removeObjects([existing.imageKey])
}

// ---------- الكوبونات ----------

async function saveCouponImpl(id: string | null, form: FormData) {
  await assertManagePermission("coupons")

  const values = { ...parseCouponForm(form), updatedAt: new Date() } as const

  try {
    if (id) {
      const couponId = uuidParam(id)
      const updated = await db.update(coupons).set(values).where(eq(coupons.id, couponId)).returning({ id: coupons.id })
      if (!updated.length) throw new Error("الكوبون غير موجود")
    } else {
      await createOnce(parseRequestId(str(form, "requestId")), "coupons", (tx, rowId) => tx.insert(coupons).values({ id: rowId, ...values }).then(() => {}))
    }
  } catch (e) {
    if (uniqueViolation(e) !== null) throw new Error("كود الخصم مستخدم بالفعل، اختر كوداً آخر")
    throw e
  }
  revalidateStore()
}

async function deleteCouponImpl(id: string) {
  await assertManagePermission("coupons")
  await db.delete(coupons).where(eq(coupons.id, uuidParam(id)))
  revalidateStore()
}

// ---------- التقييمات ----------

async function saveReviewImpl(id: string | null, form: FormData) {
  await assertManagePermission("reviews")

  const parsed = parseReviewForm(form)
  const avatarKey = newImageKey(form, "avatarKey")
  const values = { ...parsed, updatedAt: new Date() }

  let oldImage: string | null = null
  if (id) {
    const reviewId = uuidParam(id)
    const [existing] = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1)
    if (!existing) throw new Error("التقييم غير موجود")
    await db.update(reviews).set({ ...values, ...(avatarKey ? { avatarKey } : {}) }).where(eq(reviews.id, reviewId))
    if (avatarKey && existing.avatarKey !== avatarKey) oldImage = existing.avatarKey
  } else {
    await createOnce(parseRequestId(str(form, "requestId")), "reviews", (tx, rowId) => tx.insert(reviews).values({ id: rowId, ...values, avatarKey: avatarKey ?? null }).then(() => {}))
  }

  revalidateStore()
  await removeObjects([oldImage])
}

async function deleteReviewImpl(id: string) {
  await assertManagePermission("reviews")
  const reviewId = uuidParam(id)
  const [existing] = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1)
  if (!existing) return
  await db.delete(reviews).where(eq(reviews.id, reviewId))
  revalidateStore()
  await removeObjects([existing.avatarKey])
}

// ---------- الإعلانات ----------

async function saveAdImpl(id: string | null, form: FormData) {
  await assertManagePermission("ads")

  const parsed = parseAdForm(form)
  const { title, kind, newVideoKey, placements, startsOn, endsOn } = parsed
  const adId = id ? uuidParam(id) : null
  const imageKey = newImageKey(form, "imageKey")
  trackUploadKey(newVideoKey)

  // نبقي فقط الأقسام الموجودة فعلاً، ونتجاهل أي معرّف غريب.
  const requested = parsed.requestedCategoryIds
  const categoryIds = requested.length
    ? (await db.select({ id: categories.id }).from(categories).where(inArray(categories.id, requested.map((c) => uuidParam(c))))).map((r) => r.id)
    : []

  const values = {
    title,
    href: parsed.href,
    active: parsed.active,
    frequency: parsed.frequency,
    sortOrder: parsed.sortOrder,
    kind,
    placements,
    startsOn,
    endsOn,
    updatedAt: new Date(),
  }

  let oldImage: string | null = null
  let oldVideo: string | null = null
  const requestId = parseRequestId(str(form, "requestId"))
  await withSaveRequest(requestId, "ads", adId ?? crypto.randomUUID(), async (tx) => {
    let rowId: string
    if (adId) {
      const [existing] = await tx.select().from(ads).where(eq(ads.id, adId)).limit(1)
      if (!existing) throw new Error("الإعلان غير موجود")
      // الصورة العادية تمسح الفيديو؛ الفيديو يحتاج مفتاحاً جديداً أو قائماً.
      const videoKey = kind === "video" ? (newVideoKey ?? existing.videoKey) : null
      if (kind === "video" && !videoKey) throw new Error("فيديو الإعلان مطلوب")
      await tx.update(ads).set({ ...values, videoKey, ...(imageKey ? { imageKey } : {}) }).where(eq(ads.id, adId))
      if (imageKey && existing.imageKey !== imageKey) oldImage = existing.imageKey
      if (existing.videoKey && existing.videoKey !== videoKey) oldVideo = existing.videoKey
      rowId = adId
    } else {
      if (!imageKey) throw new Error(kind === "video" ? "صورة الغلاف مطلوبة" : "صورة الإعلان مطلوبة")
      if (kind === "video" && !newVideoKey) throw new Error("فيديو الإعلان مطلوب")
      const videoKey = kind === "video" ? (newVideoKey ?? null) : null
      ;[{ id: rowId }] = await tx.insert(ads).values({ ...values, imageKey, videoKey }).returning({ id: ads.id })
    }
    await tx.delete(adCategories).where(eq(adCategories.adId, rowId))
    if (categoryIds.length) await tx.insert(adCategories).values(categoryIds.map((categoryId) => ({ adId: rowId, categoryId })))
  })

  revalidateStore()
  await removeObjects([oldImage, oldVideo])
}

async function toggleAdActiveImpl(id: string, value: boolean) {
  await assertManagePermission("ads")
  await db.update(ads).set({ active: Boolean(value), updatedAt: new Date() }).where(eq(ads.id, uuidParam(id)))
  revalidateStore()
}

async function deleteAdImpl(id: string) {
  await assertManagePermission("ads")
  const adId = uuidParam(id)
  const [existing] = await db.select().from(ads).where(eq(ads.id, adId)).limit(1)
  if (!existing) return
  await db.delete(ads).where(eq(ads.id, adId))
  revalidateStore()
  await removeObjects([existing.imageKey, existing.videoKey])
}

// ---------- إعدادات المتجر (صف واحد) ----------

async function saveSettingsImpl(_id: string | null, form: FormData) {
  await assertManagePermission("settings")

  const logoKey = newImageKey(form, "logoKey")
  const parsedSettings = parseSettingsForm(form)
  // «SMS فقط» بلا مفاتيح مضبوطة يعطّل دخول كل العملاء في الإنتاج، فنرفضه (يقرأ متغيرات البيئة، فهو للخادم وحده).
  if (parsedSettings.otpChannel === "sms" && process.env.NODE_ENV === "production" && !isSmsConfigured()) {
    throw new Error("اضبط SMS_GATE_USERNAME و SMS_GATE_PASSWORD في إعدادات الاستضافة أولاً، ثم اختر SMS")
  }
  const values = { ...parsedSettings, updatedAt: new Date() }

  const [existing] = await db.select().from(siteSettings).where(eq(siteSettings.id, 1)).limit(1)
  const set = { ...values, ...(logoKey ? { logoKey } : {}) }
  await db
    .insert(siteSettings)
    .values({ id: 1, ...set })
    .onConflictDoUpdate({ target: siteSettings.id, set })

  revalidateStore()
  if (logoKey && existing?.logoKey && existing.logoKey !== logoKey) await removeObjects([existing.logoKey])
}

// ---------- مستخدمو اللوحة ----------

/**
 * هل يحق لهذا المنفّذ تعديل/تعطيل/حذف هذا المستخدم؟ المالك دائماً. غيره لا يلمس مستخدماً بدور «مدير عام»،
 * ولا مستخدماً يملك صلاحية ليست عند المنفّذ (وإلا لعدّل كلمة مرور مستخدم أقوى ثم دخل بحسابه).
 */
function assertCanManageTarget(actor: { isOwner: boolean; permissions: string[] }, target: { role: string; permissions: string[] }) {
  if (actor.isOwner) return
  if (target.role === "admin") throw new Error("حساب المدير العام لا يعدّله إلا المالك")
  if (target.permissions.some((p) => !actor.permissions.includes(p))) {
    throw new Error("لا يمكنك تعديل مستخدم يملك صلاحيات أكثر منك")
  }
}

/** معرّف صف المستخدم الحالي (للمقارنة بالمعرّف لا بالاسم، فلا يلتف عليها إعادة التسمية). المالك بلا صف. */
async function actorRowId(actor: { username: string; isOwner: boolean }): Promise<string | null> {
  if (actor.isOwner) return null
  return (await findUserByUsername(actor.username))?._id ?? null
}

async function saveUserImpl(id: string | null, form: FormData) {
  const actor = await assertManagePermission("users")

  const userId = id ? uuidParam(id) : null
  const { username, password, name, role, permissions, active } = parseUserForm(form, { isNew: !userId })
  // اسم المالك محجوز: وإلا لأخذ مستخدم مخزَّن بنفس الاسم صلاحيات المالك الكاملة.
  if (username.toLowerCase() === getManageUsername().toLowerCase()) {
    throw new Error("اسم المستخدم محجوز لحساب المالك، اختر اسماً آخر")
  }
  // لا يمنح المستخدم غيره صلاحية لا يملكها هو (إلا المالك)، ولا دور «مدير عام».
  if (!actor.isOwner) {
    const missing = permissions.filter((p) => !actor.permissions.includes(p))
    if (missing.length) throw new Error("لا يمكنك منح صلاحيات لا تملكها أنت")
    if (role === "admin") throw new Error("دور «مدير عام» لا يمنحه إلا المالك")
  }

  const existing = await findUserByUsername(username)
  if (existing && existing._id !== userId) {
    throw new Error("اسم المستخدم مُستخدم بالفعل، اختر اسماً آخر")
  }

  if (userId) {
    const [target] = await db.select().from(manageUsers).where(eq(manageUsers.id, userId)).limit(1)
    if (!target) throw new Error("المستخدم غير موجود")
    assertCanManageTarget(actor, { role: target.role, permissions: normalizePermissions(target.permissions) })
    // تعديل الشخص لنفسه: لا يُسقط صلاحية المستخدمين ولا يعطّل حسابه فيقفل اللوحة على نفسه (بالمعرّف لا بالاسم).
    if (userId === (await actorRowId(actor))) {
      if (!permissions.includes("users")) throw new Error("لا يمكنك سحب صلاحية إدارة المستخدمين من حسابك")
      if (!active) throw new Error("لا يمكنك تعطيل حسابك")
    }
  }

  const base = { username, name: name ?? null, role, permissions, active, updatedAt: new Date() } as const

  try {
    if (userId) {
      const updated = await db
        .update(manageUsers)
        .set({ ...base, ...(password ? { passwordHash: hashPassword(password) } : {}) })
        .where(eq(manageUsers.id, userId))
        .returning({ id: manageUsers.id })
      if (!updated.length) throw new Error("المستخدم غير موجود")
    } else {
      await db.insert(manageUsers).values({ ...base, passwordHash: hashPassword(password!) })
    }
  } catch (e) {
    if (uniqueViolation(e) !== null) throw new Error("اسم المستخدم مُستخدم بالفعل، اختر اسماً آخر")
    throw e
  }
  revalidateManage()
}

async function deleteUserImpl(id: string) {
  const actor = await assertManagePermission("users")
  const userId = uuidParam(id)
  const [target] = await db.select().from(manageUsers).where(eq(manageUsers.id, userId)).limit(1)
  if (!target) return
  if (userId === (await actorRowId(actor))) throw new Error("لا يمكنك حذف حسابك")
  assertCanManageTarget(actor, { role: target.role, permissions: normalizePermissions(target.permissions) })
  await db.delete(manageUsers).where(eq(manageUsers.id, userId))
  revalidateManage()
}

async function toggleUserActiveImpl(id: string, value: boolean) {
  const actor = await assertManagePermission("users")
  const userId = uuidParam(id)
  const [target] = await db.select().from(manageUsers).where(eq(manageUsers.id, userId)).limit(1)
  if (!target) throw new Error("المستخدم غير موجود")
  if (!value && userId === (await actorRowId(actor))) throw new Error("لا يمكنك تعطيل حسابك")
  assertCanManageTarget(actor, { role: target.role, permissions: normalizePermissions(target.permissions) })
  await db.update(manageUsers).set({ active: Boolean(value), updatedAt: new Date() }).where(eq(manageUsers.id, userId))
  revalidateManage()
}

/** اسم المستخدم الحالي — يُستخدم لمنع المستخدم من حذف حسابه أثناء الجلسة. */
async function getCurrentManageUserImpl(): Promise<string | null> {
  return getManageSessionUser()
}

/** حالة بوت واتساب للدخول (للوحة الإعدادات). */
async function fetchWhatsappStatusImpl() {
  await assertManagePermission("settings")
  const { getWhatsappStatus } = await import("@/lib/whatsapp-status")
  return getWhatsappStatus()
}

// الإجراءات المصدَّرة: تعيد الأخطاء المتوقعة كقيمة فتصل رسالتها للمدير في الإنتاج (انظر lib/server-action.ts).
export const generateProductSlug = serverAction(generateProductSlugImpl)
export const saveProduct = serverAction(saveProductImpl)
export const backfillImagePalettes = serverAction(backfillImagePalettesImpl)
export const deleteProduct = serverAction(deleteProductImpl)
export const toggleProductFlag = serverAction(toggleProductFlagImpl)
export const saveCategory = serverAction(saveCategoryImpl)
export const deleteCategory = serverAction(deleteCategoryImpl)
export const saveBrand = serverAction(saveBrandImpl)
export const deleteBrand = serverAction(deleteBrandImpl)
export const saveSlide = serverAction(saveSlideImpl)
export const deleteSlide = serverAction(deleteSlideImpl)
export const saveCoupon = serverAction(saveCouponImpl)
export const deleteCoupon = serverAction(deleteCouponImpl)
export const saveReview = serverAction(saveReviewImpl)
export const deleteReview = serverAction(deleteReviewImpl)
export const saveAd = serverAction(saveAdImpl)
export const toggleAdActive = serverAction(toggleAdActiveImpl)
export const deleteAd = serverAction(deleteAdImpl)
export const saveSettings = serverAction(saveSettingsImpl)
export const saveUser = serverAction(saveUserImpl)
export const deleteUser = serverAction(deleteUserImpl)
export const toggleUserActive = serverAction(toggleUserActiveImpl)
export const getCurrentManageUser = serverAction(getCurrentManageUserImpl)
export const fetchWhatsappStatus = serverAction(fetchWhatsappStatusImpl)
