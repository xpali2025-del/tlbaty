"use server"

import { serverAction } from "@/lib/server-action"
import { parseSizeChart, validateSizeChart, type SizeChart } from "@/lib/size-chart"
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
import { refreshProductSearch } from "@/lib/search-index"
import { productsMissingPalette, refreshProductPalette } from "@/lib/product-palette"
import { allocateProductCode, ensureCategoryCode } from "@/lib/product-code-db"
import { isCategoryCode } from "@/lib/product-code"
import { normalizePlacements, parseDateOnly } from "@/lib/ads"
import { isOtpChannel } from "@/lib/otp/channel"
import { isSmsConfigured } from "@/lib/otp/providers/sms"
import { isValidVideoKey } from "@/lib/storage/keys"
import { isRole, normalizePermissions, ROLE_PRESETS, type Role } from "@/lib/permissions"
import { SUPPORTED_COUNTRIES } from "@/lib/phone"
import {
  bool,
  englishSlug,
  json,
  newImageKey,
  newImageKeys,
  num,
  removeObjects,
  revalidateManage,
  revalidateStore,
  runAfterResponse,
  slugify,
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

const HEX = /^#[0-9a-fA-F]{6}$/

// ---------- المنتجات ----------

async function saveProductImpl(id: string | null, form: FormData) {
  await assertManagePermission("products")

  const name = str(form, "name")
  const categoryRaw = str(form, "categoryId")
  const price = num(form, "price")
  if (!name) throw new Error("اسم المنتج مطلوب")
  if (!categoryRaw) throw new Error("اختر القسم الرئيسي للمنتج")
  if (price === undefined) throw new Error("أدخل سعراً صحيحاً")
  if (price < 0) throw new Error("السعر لا يمكن أن يكون سالباً")
  const categoryId = uuidParam(categoryRaw, "القسم غير صالح")
  const productId = id ? uuidParam(id) : null

  const [category] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1)
  if (!category) throw new Error("القسم غير موجود")

  const subSlug = str(form, "subcategory")
  let subcategoryId: string | null = null
  if (subSlug) {
    const [sub] = await db
      .select({ id: subcategories.id })
      .from(subcategories)
      .where(and(eq(subcategories.categoryId, categoryId), eq(subcategories.slug, subSlug)))
      .limit(1)
    subcategoryId = sub?.id ?? null
  }
  const brandId = str(form, "brandId") ? uuidParam(str(form, "brandId"), "البراند غير صالح") : null

  const slug = slugify(str(form, "slug") ?? name)
  const mainKey = newImageKey(form, "imageKey")
  const addedKeys = newImageKeys(form, "newImageKeys")
  const keptRefs = json<string[]>(form, "keptImages", [])

  const colors = json<{ name: string; hex: string }[]>(form, "colors", []).map((c) => {
    if (!c?.name?.trim() || !HEX.test(c.hex ?? "")) throw new Error("لون غير صالح: الاسم مطلوب واللون بصيغة #RRGGBB")
    return { name: c.name.trim(), hex: c.hex }
  })
  const sizeList = json<string[]>(form, "sizes", []).map((x) => String(x).trim()).filter(Boolean)
  // مخزون كل لون/مقاس (اختياري): كل تركيبة يجب أن تكون من ألوان ومقاسات المنتج نفسه، بلا تكرار.
  const trackVariants = bool(form, "trackVariants")
  const variantInput = trackVariants ? json<{ color?: string; size?: string; stock?: number; base?: number }[]>(form, "variants", []) : []
  const variants = new Map<string, { color: string; size: string; stock: number; base: number | undefined }>()
  for (const v of variantInput) {
    const color = String(v.color ?? "").trim()
    const size = String(v.size ?? "").trim()
    if (color && !colors.some((c) => c.name === color)) throw new Error(`اللون "${color}" ليس من ألوان المنتج`)
    if (size && !sizeList.includes(size)) throw new Error(`المقاس "${size}" ليس من مقاسات المنتج`)
    const stock = Math.trunc(Number(v.stock))
    if (!Number.isFinite(stock) || stock < 0 || stock > 1_000_000) throw new Error("كمية المخزون لكل لون/مقاس يجب أن تكون عدداً صحيحاً من 0 إلى 1,000,000")
    const baseRaw = v.base === undefined || v.base === null ? undefined : Math.trunc(Number(v.base))
    const key = `${color}\u0000${size}`
    if (variants.has(key)) throw new Error("تركيبة لون/مقاس مكررة")
    variants.set(key, { color, size, stock, base: baseRaw !== undefined && Number.isFinite(baseRaw) && baseRaw >= 0 ? baseRaw : undefined })
  }
  if (trackVariants && variants.size === 0) throw new Error("أضف ألواناً أو مقاسات لتتبع مخزونها، أو أوقف تتبع المخزون حسب اللون والمقاس")
  // دليل المقاسات (اختياري): none | chart (جدول مشترك) | custom (خاص بهذا المنتج).
  const guide = json<{ mode?: string; chartId?: string; custom?: unknown }>(form, "sizeGuide", { mode: "none" })
  let sizeChartId: string | null = null
  let customSizeChart: SizeChart | null = null
  if (guide.mode === "chart") {
    sizeChartId = uuidParam(guide.chartId, "جدول المقاسات غير صالح")
    const [chart] = await db.select({ id: sizeCharts.id }).from(sizeCharts).where(eq(sizeCharts.id, sizeChartId)).limit(1)
    if (!chart) throw new Error("جدول المقاسات المختار غير موجود")
  } else if (guide.mode === "custom") {
    customSizeChart = parseSizeChart(guide.custom)
    const problem = customSizeChart ? validateSizeChart(customSizeChart) : "بيانات جدول المقاسات غير صالحة"
    if (problem) throw new Error(problem)
  }
  const flags = { isNew: bool(form, "isNew"), isBestseller: bool(form, "isBestseller") }
  const stockBaseRaw = num(form, "stockBase")
  const stockBase = stockBaseRaw === undefined ? undefined : Math.max(0, Math.trunc(stockBaseRaw))

  const base = {
    name,
    slug,
    description: str(form, "description") ?? "",
    price,
    oldPrice: num(form, "oldPrice") ?? null,
    categoryId,
    subcategoryId,
    brandId,
    stock: Math.max(0, Math.trunc(num(form, "stock") ?? 0)),
    isNew: flags.isNew,
    isBestseller: flags.isBestseller,
    badge: str(form, "badge") ?? null,
    sortOrder: Math.trunc(num(form, "sortOrder") ?? 0),
    sku: str(form, "sku") ?? null,
    metaTitle: str(form, "metaTitle") ?? null,
    metaDescription: str(form, "metaDescription") ?? null,
    sizes: json<string[]>(form, "sizes", []),
    sizeChartId,
    customSizeChart,
    keywords: json<string[]>(form, "keywords", []),
    updatedAt: new Date(),
  }

  const removed: (string | null)[] = []
  let savedId: string | null = null
  try {
    await db.transaction(async (tx) => {
      let rowId: string
      let existingKeys: string[] = []
      if (productId) {
        const [existing] = await tx.select().from(products).where(eq(products.id, productId)).limit(1)
        if (!existing) throw new Error("المنتج غير موجود")
        existingKeys = (await tx.select().from(productImages).where(eq(productImages.productId, productId))).map((i) => i.imageKey)
        await tx
          .update(products)
          .set({
            ...base,
            // المخزون يُطبَّق كفرق عمّا رآه المدير عند فتح النموذج، لا كقيمة مطلقة: وإلا مسح حفظ تعديل سعر
            // خصم الطلبات التي جرت أثناء فتح النموذج وسمح ببيع ما نفد.
            stock: stockBase === undefined ? base.stock : sql`greatest(0, ${products.stock} + ${base.stock - stockBase})`,
            tags: syncTags(existing.tags, flags),
            ...(mainKey ? { mainImageKey: mainKey } : {}),
          })
          .where(eq(products.id, productId))
        if (mainKey && existing.mainImageKey !== mainKey) removed.push(existing.mainImageKey)
        rowId = productId
      } else {
        // رمز قصير بالتسلسل داخل القسم (مثل DR-012)، يُحجز ذرياً فلا يتكرر.
        const productNumber = await allocateProductCode(tx, categoryId)
        const [inserted] = await tx
          .insert(products)
          .values({ ...base, productNumber, rating: 5, reviewsCount: 0, tags: [], mainImageKey: mainKey ?? null })
          .returning({ id: products.id })
        rowId = inserted.id
      }

      // نثق فقط بالمراجع التي ما زالت موجودة فعلاً في معرض المنتج؛ أي مرجع غريب يُتجاهل.
      const kept = keptRefs.filter((k) => existingKeys.includes(k))
      removed.push(...existingKeys.filter((k) => !kept.includes(k)))
      const gallery = [...kept, ...addedKeys]
      await tx.delete(productImages).where(eq(productImages.productId, rowId))
      await tx.delete(productColors).where(eq(productColors.productId, rowId))
      if (gallery.length) {
        await tx.insert(productImages).values(gallery.map((imageKey, i) => ({ productId: rowId, imageKey, sortOrder: i })))
      }
      if (colors.length) {
        await tx.insert(productColors).values(colors.map((c, i) => ({ productId: rowId, name: c.name, hex: c.hex, sortOrder: i })))
      }
      await saveVariantStock(tx, rowId, trackVariants ? [...variants.values()] : null)
      await refreshProductSearch(tx, { productIds: [rowId] })
      savedId = rowId
    })
  } catch (e) {
    const constraint = uniqueViolation(e)
    if (constraint?.includes("slug")) throw new Error("هذا الرابط (slug) مستخدم لمنتج آخر، اختر رابطاً مختلفاً")
    if (constraint !== null) throw new Error("تعذّر الحفظ بسبب تعارض في البيانات")
    throw e
  }

  revalidateStore()
  // أعمال غير حرجة بعد الرد: حذف الصور القديمة، وبصمة الألوان للبحث بالصورة (قراءة من R2 + معالجة) عند صورة رئيسية جديدة.
  const paletteFor = mainKey && savedId ? { id: savedId, key: mainKey } : null
  await runAfterResponse(async () => {
    await removeObjects(removed)
    if (paletteFor) await refreshProductPalette(paletteFor.id, paletteFor.key).catch(() => false)
  })
}

/**
 * يحفظ مخزون ألوان/مقاسات المنتج. كالمخزون الواحد، يُطبَّق كفرق عمّا رآه المدير عند فتح النموذج (base)
 * فلا يمسح الحفظ خصم طلبات جرت أثناء فتح النموذج. تركيبة جديدة تأخذ القيمة المدخلة. المحذوفة تُحذف.
 * `null` = إيقاف التتبع (حذف المتغيّرات والعودة للمخزون الواحد). المخزون الإجمالي يصير مجموع المتغيّرات.
 */
async function saveVariantStock(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  productId: string,
  next: { color: string; size: string; stock: number; base: number | undefined }[] | null,
) {
  if (next === null) {
    await tx.delete(productVariants).where(eq(productVariants.productId, productId))
    return
  }
  const existing = new Map(
    (await tx.select().from(productVariants).where(eq(productVariants.productId, productId)).for("update")).map((v) => [`${v.color}\u0000${v.size}`, v]),
  )
  const keep = new Set<string>()
  for (const v of next) {
    const key = `${v.color}\u0000${v.size}`
    keep.add(key)
    const row = existing.get(key)
    if (!row) {
      await tx.insert(productVariants).values({ productId, color: v.color, size: v.size, stock: v.stock })
    } else {
      const stock = v.base === undefined ? v.stock : Math.max(0, row.stock + (v.stock - v.base))
      await tx.update(productVariants).set({ stock }).where(eq(productVariants.id, row.id))
    }
  }
  for (const [key, row] of existing) if (!keep.has(key)) await tx.delete(productVariants).where(eq(productVariants.id, row.id))
  await tx
    .update(products)
    .set({ stock: sql`coalesce((select sum(${productVariants.stock}) from ${productVariants} where ${productVariants.productId} = ${productId}), 0)` })
    .where(eq(products.id, productId))
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
  await runAfterResponse(() => removeObjects([existing.mainImageKey, ...gallery.map((g) => g.imageKey)]))
}

async function toggleProductFlagImpl(id: string, field: "isNew" | "isBestseller", value: boolean) {
  await assertManagePermission("products")
  if (field !== "isNew" && field !== "isBestseller") throw new Error("حقل غير مدعوم")
  const productId = uuidParam(id)
  const [existing] = await db.select().from(products).where(eq(products.id, productId)).limit(1)
  if (!existing) throw new Error("المنتج غير موجود")
  await db
    .update(products)
    .set({ [field]: value, tags: syncTags(existing.tags, { [field]: value }), updatedAt: new Date() })
    .where(eq(products.id, productId))
  revalidateStore()
}

// ---------- الأقسام ----------

async function saveCategoryImpl(id: string | null, form: FormData) {
  await assertManagePermission("categories")

  const name = str(form, "name")
  if (!name) throw new Error("اسم القسم مطلوب")
  const categoryId = id ? uuidParam(id) : null
  const imageKey = newImageKey(form, "imageKey")

  // السلاج الفرعي فريد داخل القسم؛ عند تكراره في النموذج يفوز آخر إدخال.
  const incoming = new Map<string, { name: string; description: string | null }>()
  for (const s of json<{ name: string; slug?: string; description?: string }[]>(form, "subcategories", [])) {
    if (!s?.name?.trim()) continue
    incoming.set(slugify(s.slug || s.name), { name: s.name.trim(), description: s.description?.trim() || null })
  }

  const codeRaw = str(form, "code")?.toUpperCase()
  if (codeRaw && !isCategoryCode(codeRaw)) throw new Error("رمز القسم: 2 إلى 4 أحرف إنجليزية (ورقم اختياري في الآخر)، مثل DR")

  const values = {
    name,
    slug: slugify(str(form, "slug") ?? name),
    ...(codeRaw ? { code: codeRaw } : {}),
    description: str(form, "description") ?? null,
    sortOrder: Math.max(0, Math.trunc(num(form, "sortOrder") ?? 0)),
    metaTitle: str(form, "metaTitle") ?? null,
    metaDescription: str(form, "metaDescription") ?? null,
    keywords: json<string[]>(form, "keywords", []),
    updatedAt: new Date(),
  }

  let oldImage: string | null = null
  try {
    await db.transaction(async (tx) => {
      let rowId: string
      if (categoryId) {
        const [existing] = await tx.select().from(categories).where(eq(categories.id, categoryId)).limit(1)
        if (!existing) throw new Error("القسم غير موجود")
        await tx.update(categories).set({ ...values, ...(imageKey ? { imageKey } : {}) }).where(eq(categories.id, categoryId))
        if (imageKey && existing.imageKey !== imageKey) oldImage = existing.imageKey
        rowId = categoryId
      } else {
        ;[{ id: rowId }] = await tx.insert(categories).values({ ...values, imageKey: imageKey ?? null }).returning({ id: categories.id })
      }
      await ensureCategoryCode(tx, rowId)

      const current = await tx.select().from(subcategories).where(eq(subcategories.categoryId, rowId))
      const stale = current.filter((c) => !incoming.has(c.slug)).map((c) => c.id)
      if (stale.length) await tx.delete(subcategories).where(inArray(subcategories.id, stale))
      let order = 0
      for (const [slug, sub] of incoming) {
        const row = { categoryId: rowId, slug, name: sub.name, description: sub.description, sortOrder: order++ }
        await tx
          .insert(subcategories)
          .values(row)
          .onConflictDoUpdate({ target: [subcategories.categoryId, subcategories.slug], set: row })
      }
      // إعادة تسمية القسم أو أقسامه الفرعية تغيّر نص بحث منتجاته.
      if (categoryId) await refreshProductSearch(tx, { categoryId: rowId })
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

  const name = str(form, "name")
  if (!name) throw new Error("اسم البراند مطلوب")
  const brandId = id ? uuidParam(id) : null
  const imageKey = newImageKey(form, "imageKey")

  const values = {
    name,
    slug: slugify(str(form, "slug") ?? name),
    description: str(form, "description") ?? null,
    featured: bool(form, "featured"),
    sortOrder: Math.max(0, Math.trunc(num(form, "sortOrder") ?? 0)),
    metaTitle: str(form, "metaTitle") ?? null,
    metaDescription: str(form, "metaDescription") ?? null,
    keywords: json<string[]>(form, "keywords", []),
    updatedAt: new Date(),
  }

  let oldImage: string | null = null
  try {
    if (brandId) {
      const [existing] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1)
      if (!existing) throw new Error("البراند غير موجود")
      await db.update(brands).set({ ...values, ...(imageKey ? { imageKey } : {}) }).where(eq(brands.id, brandId))
      if (existing.name !== values.name) await refreshProductSearch(db, { brandId })
      if (imageKey && existing.imageKey !== imageKey) oldImage = existing.imageKey
    } else {
      await db.insert(brands).values({ ...values, imageKey: imageKey ?? null })
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

  const title = str(form, "title")
  if (!title) throw new Error("عنوان السلايد مطلوب")
  const slideId = id ? uuidParam(id) : null
  const imageKey = newImageKey(form, "imageKey")

  const values = {
    title,
    subtitle: str(form, "subtitle") ?? null,
    cta: str(form, "cta") ?? null,
    href: str(form, "href") ?? "/",
    sortOrder: Math.trunc(num(form, "sortOrder") ?? 0),
    updatedAt: new Date(),
  }

  let oldImage: string | null = null
  if (slideId) {
    const [existing] = await db.select().from(slides).where(eq(slides.id, slideId)).limit(1)
    if (!existing) throw new Error("الشريحة غير موجودة")
    await db.update(slides).set({ ...values, ...(imageKey ? { imageKey } : {}) }).where(eq(slides.id, slideId))
    if (imageKey && existing.imageKey !== imageKey) oldImage = existing.imageKey
  } else {
    if (!imageKey) throw new Error("صورة السلايد مطلوبة")
    await db.insert(slides).values({ ...values, imageKey })
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

  const code = str(form, "code")
  const discount = num(form, "discount")
  const description = str(form, "description")
  const type = str(form, "type") === "percent" ? "percent" : "fixed"
  if (!code) throw new Error("كود الخصم مطلوب")
  if (discount === undefined) throw new Error("قيمة الخصم مطلوبة")
  if (discount < 0) throw new Error("قيمة الخصم لا يمكن أن تكون سالبة")
  if (type === "percent" && discount > 100) throw new Error("نسبة الخصم لا يمكن أن تتجاوز 100%")
  if (!description) throw new Error("وصف الكوبون مطلوب")

  const values = {
    code: code.toUpperCase(),
    discount,
    type,
    minOrder: Math.max(0, num(form, "minOrder") ?? 0),
    description,
    updatedAt: new Date(),
  } as const

  try {
    if (id) {
      const couponId = uuidParam(id)
      const updated = await db.update(coupons).set(values).where(eq(coupons.id, couponId)).returning({ id: coupons.id })
      if (!updated.length) throw new Error("الكوبون غير موجود")
    } else {
      await db.insert(coupons).values(values)
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

  const name = str(form, "name")
  const comment = str(form, "comment")
  const rating = num(form, "rating") ?? 5
  if (!name) throw new Error("اسم العميل مطلوب")
  if (!comment) throw new Error("نص التقييم مطلوب")
  const date = str(form, "date") ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("تاريخ غير صالح")
  const avatarKey = newImageKey(form, "avatarKey")

  const values = {
    name,
    comment,
    rating: Math.min(5, Math.max(1, Math.round(rating))),
    reviewDate: date,
    updatedAt: new Date(),
  }

  let oldImage: string | null = null
  if (id) {
    const reviewId = uuidParam(id)
    const [existing] = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1)
    if (!existing) throw new Error("التقييم غير موجود")
    await db.update(reviews).set({ ...values, ...(avatarKey ? { avatarKey } : {}) }).where(eq(reviews.id, reviewId))
    if (avatarKey && existing.avatarKey !== avatarKey) oldImage = existing.avatarKey
  } else {
    await db.insert(reviews).values({ ...values, avatarKey: avatarKey ?? null })
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

  const title = str(form, "title")
  if (!title) throw new Error("اسم الإعلان مطلوب")
  const adId = id ? uuidParam(id) : null
  const imageKey = newImageKey(form, "imageKey")

  const kind = str(form, "kind") === "video" ? "video" : "image"
  const newVideoKey = str(form, "videoKey")
  if (newVideoKey && !isValidVideoKey(newVideoKey)) throw new Error("مفتاح الفيديو غير صالح")
  const placements = normalizePlacements(json<unknown>(form, "placements", []))
  const startsOn = parseDateOnly(str(form, "startsOn")) ?? null
  const endsOn = parseDateOnly(str(form, "endsOn")) ?? null
  if (str(form, "startsOn") && !startsOn) throw new Error("تاريخ البداية غير صالح")
  if (str(form, "endsOn") && !endsOn) throw new Error("تاريخ النهاية غير صالح")
  if (startsOn && endsOn && startsOn > endsOn) throw new Error("تاريخ النهاية يجب ألا يسبق تاريخ البداية")

  // نبقي فقط الأقسام الموجودة فعلاً، ونتجاهل أي معرّف غريب.
  const requested = json<string[]>(form, "categoryIds", []).filter((c) => typeof c === "string")
  const categoryIds = requested.length
    ? (await db.select({ id: categories.id }).from(categories).where(inArray(categories.id, requested.map((c) => uuidParam(c))))).map((r) => r.id)
    : []

  const values = {
    title,
    href: str(form, "href") ?? null,
    active: bool(form, "active"),
    frequency: Math.max(1, Math.trunc(num(form, "frequency") ?? 6)),
    sortOrder: Math.trunc(num(form, "sortOrder") ?? 0),
    kind,
    placements,
    startsOn,
    endsOn,
    updatedAt: new Date(),
  }

  let oldImage: string | null = null
  let oldVideo: string | null = null
  await db.transaction(async (tx) => {
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

/** رابط تواصل اجتماعي: رابط http(s) كامل أو اسم حساب فقط. أي بروتوكول آخر (javascript: وغيره) مرفوض. */
function socialField(form: FormData, key: string, label: string): string | null {
  const value = str(form, key)
  if (!value) return null
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString().slice(0, 300)
    } catch {
      // يسقط إلى رسالة الخطأ
    }
    throw new Error(`رابط ${label} غير صالح`)
  }
  if (/^@?[A-Za-z0-9._-]{1,60}$/.test(value)) return value
  throw new Error(`${label}: أدخل رابطاً كاملاً (https://…) أو اسم الحساب فقط`)
}

async function saveSettingsImpl(_id: string | null, form: FormData) {
  await assertManagePermission("settings")

  const logoKey = newImageKey(form, "logoKey")
  const phone = str(form, "phone") ?? null
  if (phone && !/^[+0-9][0-9 ()-]{4,24}$/.test(phone)) throw new Error("رقم الهاتف غير صالح")
  const secondaryPhone = str(form, "secondaryPhone") ?? null
  if (secondaryPhone && !/^[+0-9][0-9 ()-]{4,24}$/.test(secondaryPhone)) throw new Error("رقم الهاتف الثاني غير صالح")
  const whatsapp = str(form, "whatsapp") ?? null
  if (whatsapp) {
    const digits = whatsapp.replace(/\D/g, "")
    if (digits.length < 8 || digits.length > 15) throw new Error("رقم واتساب غير صالح (بالصيغة الدولية، مثل 967771234567)")
  }
  const email = str(form, "email") ?? null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("البريد الإلكتروني غير صالح")

  const codEnabled = bool(form, "codEnabled")
  const transferEnabled = bool(form, "transferEnabled")
  const walletEnabled = bool(form, "walletEnabled")
  // رقم بوت واتساب للدخول: أرقام دولية فقط (8 إلى 15)، والفارغ يعني استعمال متغير البيئة.
  const botRaw = (str(form, "loginBotNumber") ?? "").replace(/[\s+()-]/g, "")
  if (botRaw && !/^[0-9]{8,15}$/.test(botRaw)) throw new Error("رقم بوت الدخول: أرقام دولية فقط بلا رموز (مثل 967777000000)")
  const loginBotNumber = botRaw || null
  // دول تسجيل الدخول: تُحدَّث فقط إذا أُرسل حقل الدول (علامة loginCountriesPresent)، لأن الخانة غير المعلّمة لا تُرسَل أصلاً.
  // الأكواد المدعومة فقط ودولة واحدة على الأقل (الافتراضي اليمن).
  let loginCountries: string[] | undefined
  if (form.get("loginCountriesPresent") === "1") {
    const wantedCountries = form.getAll("loginCountries").map(String)
    if (wantedCountries.some((c) => !SUPPORTED_COUNTRIES.some((s) => s.code === c))) throw new Error("دولة غير مدعومة لتسجيل الدخول")
    loginCountries = SUPPORTED_COUNTRIES.filter((c) => wantedCountries.includes(c.code)).map((c) => c.code as string)
    if (loginCountries.length === 0) throw new Error("اختر دولة واحدة على الأقل لتسجيل دخول العملاء")
  }
  // قناة إرسال رمز التحقق: تُحدَّث فقط إذا أُرسلت (النماذج القديمة لا تحملها).
  const otpChannelRaw = str(form, "otpChannel")
  if (otpChannelRaw && !isOtpChannel(otpChannelRaw)) throw new Error("قناة إرسال رمز التحقق غير صالحة")
  // «SMS فقط» بلا مفاتيح مضبوطة يعطّل دخول كل العملاء في الإنتاج، فنرفضه.
  if (otpChannelRaw === "sms" && process.env.NODE_ENV === "production" && !isSmsConfigured()) {
    throw new Error("اضبط SMS_GATE_USERNAME و SMS_GATE_PASSWORD في إعدادات الاستضافة أولاً، ثم اختر SMS")
  }
  // حذف صور الإثبات تلقائياً: غير مفعّل افتراضياً؛ عند التفعيل المدة بين 7 و365 يوماً.
  let proofRetentionDays: number | null = null
  if (bool(form, "proofRetentionEnabled")) {
    const days = Number(str(form, "proofRetentionDays"))
    if (!Number.isInteger(days) || days < 7 || days > 365) throw new Error("مدة الاحتفاظ بصور الإثبات: عدد صحيح من 7 إلى 365 يوماً")
    proofRetentionDays = days
  }
  if (!codEnabled && !transferEnabled) throw new Error("فعّل طريقة دفع واحدة على الأقل، وإلا لن يستطيع العملاء إتمام الطلب")

  const values = {
    name: str(form, "name") ?? null,
    nameEn: str(form, "nameEn") ?? null,
    tagline: str(form, "tagline") ?? null,
    description: str(form, "description") ?? null,
    phone,
    secondaryPhone,
    whatsapp,
    email,
    address: str(form, "address") ?? null,
    workingHours: str(form, "workingHours") ?? null,
    copyright: str(form, "copyright") ?? null,
    instagram: socialField(form, "instagram", "إنستغرام"),
    facebook: socialField(form, "facebook", "فيسبوك"),
    tiktok: socialField(form, "tiktok", "تيك توك"),
    x: socialField(form, "x", "إكس"),
    youtube: socialField(form, "youtube", "يوتيوب"),
    snapchat: socialField(form, "snapchat", "سناب شات"),
    telegram: socialField(form, "telegram", "تيليجرام"),
    codEnabled,
    transferEnabled,
    walletEnabled,
    proofRetentionDays,
    loginBotNumber,
    ...(loginCountries ? { loginCountries } : {}),
    ...(otpChannelRaw ? { otpChannel: otpChannelRaw } : {}),
    updatedAt: new Date(),
  }

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

  const username = str(form, "username")
  const password = str(form, "password")
  const name = str(form, "name")
  const roleRaw = str(form, "role")
  const role: Role = isRole(roleRaw) ? roleRaw : "editor"
  const permissions = normalizePermissions(json<unknown>(form, "permissions", ROLE_PRESETS[role]))
  const active = bool(form, "active")
  const userId = id ? uuidParam(id) : null

  if (!username) throw new Error("اسم المستخدم مطلوب")
  if (!/^[a-zA-Z0-9._-]{3,}$/.test(username)) {
    throw new Error("اسم المستخدم يجب أن يكون 3 أحرف على الأقل (أحرف/أرقام إنجليزية بدون مسافات)")
  }
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
      if (password && password.length < 6) throw new Error("كلمة المرور يجب أن تكون 6 أحرف على الأقل")
      const updated = await db
        .update(manageUsers)
        .set({ ...base, ...(password ? { passwordHash: hashPassword(password) } : {}) })
        .where(eq(manageUsers.id, userId))
        .returning({ id: manageUsers.id })
      if (!updated.length) throw new Error("المستخدم غير موجود")
    } else {
      if (!password || password.length < 6) {
        throw new Error("كلمة المرور مطلوبة (6 أحرف على الأقل)")
      }
      await db.insert(manageUsers).values({ ...base, passwordHash: hashPassword(password) })
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
