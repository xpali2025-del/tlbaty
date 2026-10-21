"use server"

import { generateText } from "ai"
import { and, count, eq, inArray } from "drizzle-orm"
import { db } from "@/lib/db/client"
import {
  adCategories,
  ads,
  brands,
  categories,
  coupons,
  manageUsers,
  productColors,
  productImages,
  products,
  reviews,
  siteSettings,
  slides,
  subcategories,
} from "@/lib/db/store"
import { assertManageAuthenticated, getManageSessionUser } from "@/lib/manage-auth"
import {
  bool,
  englishSlug,
  json,
  makeProductId,
  newImageKey,
  newImageKeys,
  num,
  removeObjects,
  revalidateManage,
  revalidateStore,
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
export async function generateProductSlug(input: {
  category?: string
  product?: string
  brand?: string
}): Promise<string> {
  await assertManageAuthenticated()

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

export async function saveProduct(id: string | null, form: FormData) {
  await assertManageAuthenticated()

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
  const flags = { isNew: bool(form, "isNew"), isBestseller: bool(form, "isBestseller") }

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
    keywords: json<string[]>(form, "keywords", []),
    updatedAt: new Date(),
  }

  const removed: (string | null)[] = []
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
          .set({ ...base, tags: syncTags(existing.tags, flags), ...(mainKey ? { mainImageKey: mainKey } : {}) })
          .where(eq(products.id, productId))
        if (mainKey && existing.mainImageKey !== mainKey) removed.push(existing.mainImageKey)
        rowId = productId
      } else {
        // رقم المنتج عشوائي؛ نعيد المحاولة في الحالة النادرة لتصادمه مع رقم موجود.
        let inserted: { id: string } | undefined
        for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
          try {
            ;[inserted] = await tx.transaction(async (inner) =>
              inner
                .insert(products)
                .values({
                  ...base,
                  productNumber: makeProductId(category.slug, subSlug),
                  rating: 5,
                  reviewsCount: 0,
                  tags: [],
                  mainImageKey: mainKey ?? null,
                })
                .returning({ id: products.id }),
            )
          } catch (e) {
            if (!uniqueViolation(e)?.includes("product_number")) throw e
          }
        }
        if (!inserted) throw new Error("تعذّر توليد رقم منتج فريد، حاول مرة أخرى")
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
    })
  } catch (e) {
    const constraint = uniqueViolation(e)
    if (constraint?.includes("slug")) throw new Error("هذا الرابط (slug) مستخدم لمنتج آخر، اختر رابطاً مختلفاً")
    if (constraint !== null) throw new Error("تعذّر الحفظ بسبب تعارض في البيانات")
    throw e
  }

  revalidateStore()
  await removeObjects(removed)
}

export async function deleteProduct(id: string) {
  await assertManageAuthenticated()
  const productId = uuidParam(id)
  const [existing] = await db.select().from(products).where(eq(products.id, productId)).limit(1)
  if (!existing) return
  const gallery = await db.select().from(productImages).where(eq(productImages.productId, productId))
  await db.delete(products).where(eq(products.id, productId))
  revalidateStore()
  await removeObjects([existing.mainImageKey, ...gallery.map((g) => g.imageKey)])
}

export async function toggleProductFlag(id: string, field: "isNew" | "isBestseller", value: boolean) {
  await assertManageAuthenticated()
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

export async function saveCategory(id: string | null, form: FormData) {
  await assertManageAuthenticated()

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

  const values = {
    name,
    slug: slugify(str(form, "slug") ?? name),
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
    })
  } catch (e) {
    if (uniqueViolation(e) !== null) throw new Error("هذا الرابط (slug) مستخدم لقسم آخر، اختر رابطاً مختلفاً")
    throw e
  }

  revalidateStore()
  await removeObjects([oldImage])
}

export async function deleteCategory(id: string) {
  await assertManageAuthenticated()
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

export async function saveBrand(id: string | null, form: FormData) {
  await assertManageAuthenticated()

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

export async function deleteBrand(id: string) {
  await assertManageAuthenticated()
  const brandId = uuidParam(id)
  const [existing] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!existing) return
  await db.delete(brands).where(eq(brands.id, brandId))
  revalidateStore()
  await removeObjects([existing.imageKey])
}

// ---------- السلايدر ----------

export async function saveSlide(id: string | null, form: FormData) {
  await assertManageAuthenticated()

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

export async function deleteSlide(id: string) {
  await assertManageAuthenticated()
  const slideId = uuidParam(id)
  const [existing] = await db.select().from(slides).where(eq(slides.id, slideId)).limit(1)
  if (!existing) return
  await db.delete(slides).where(eq(slides.id, slideId))
  revalidateStore()
  await removeObjects([existing.imageKey])
}

// ---------- الكوبونات ----------

export async function saveCoupon(id: string | null, form: FormData) {
  await assertManageAuthenticated()

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

export async function deleteCoupon(id: string) {
  await assertManageAuthenticated()
  await db.delete(coupons).where(eq(coupons.id, uuidParam(id)))
  revalidateStore()
}

// ---------- التقييمات ----------

export async function saveReview(id: string | null, form: FormData) {
  await assertManageAuthenticated()

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

export async function deleteReview(id: string) {
  await assertManageAuthenticated()
  const reviewId = uuidParam(id)
  const [existing] = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1)
  if (!existing) return
  await db.delete(reviews).where(eq(reviews.id, reviewId))
  revalidateStore()
  await removeObjects([existing.avatarKey])
}

// ---------- الإعلانات ----------

export async function saveAd(id: string | null, form: FormData) {
  await assertManageAuthenticated()

  const title = str(form, "title")
  if (!title) throw new Error("اسم الإعلان مطلوب")
  const adId = id ? uuidParam(id) : null
  const imageKey = newImageKey(form, "imageKey")

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
    updatedAt: new Date(),
  }

  let oldImage: string | null = null
  await db.transaction(async (tx) => {
    let rowId: string
    if (adId) {
      const [existing] = await tx.select().from(ads).where(eq(ads.id, adId)).limit(1)
      if (!existing) throw new Error("الإعلان غير موجود")
      await tx.update(ads).set({ ...values, ...(imageKey ? { imageKey } : {}) }).where(eq(ads.id, adId))
      if (imageKey && existing.imageKey !== imageKey) oldImage = existing.imageKey
      rowId = adId
    } else {
      if (!imageKey) throw new Error("صورة الإعلان مطلوبة")
      ;[{ id: rowId }] = await tx.insert(ads).values({ ...values, imageKey }).returning({ id: ads.id })
    }
    await tx.delete(adCategories).where(eq(adCategories.adId, rowId))
    if (categoryIds.length) await tx.insert(adCategories).values(categoryIds.map((categoryId) => ({ adId: rowId, categoryId })))
  })

  revalidateStore()
  await removeObjects([oldImage])
}

export async function toggleAdActive(id: string, value: boolean) {
  await assertManageAuthenticated()
  await db.update(ads).set({ active: Boolean(value), updatedAt: new Date() }).where(eq(ads.id, uuidParam(id)))
  revalidateStore()
}

export async function deleteAd(id: string) {
  await assertManageAuthenticated()
  const adId = uuidParam(id)
  const [existing] = await db.select().from(ads).where(eq(ads.id, adId)).limit(1)
  if (!existing) return
  await db.delete(ads).where(eq(ads.id, adId))
  revalidateStore()
  await removeObjects([existing.imageKey])
}

// ---------- إعدادات المتجر (صف واحد) ----------

export async function saveSettings(_id: string | null, form: FormData) {
  await assertManageAuthenticated()

  const logoKey = newImageKey(form, "logoKey")
  const values = {
    name: str(form, "name") ?? null,
    tagline: str(form, "tagline") ?? null,
    description: str(form, "description") ?? null,
    phone: str(form, "phone") ?? null,
    whatsapp: str(form, "whatsapp") ?? null,
    email: str(form, "email") ?? null,
    address: str(form, "address") ?? null,
    workingHours: str(form, "workingHours") ?? null,
    copyright: str(form, "copyright") ?? null,
    instagram: str(form, "instagram") ?? null,
    facebook: str(form, "facebook") ?? null,
    tiktok: str(form, "tiktok") ?? null,
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

export async function saveUser(id: string | null, form: FormData) {
  await assertManageAuthenticated()

  const username = str(form, "username")
  const password = str(form, "password")
  const name = str(form, "name")
  const role = str(form, "role") === "admin" ? "admin" : "editor"
  const active = bool(form, "active")
  const userId = id ? uuidParam(id) : null

  if (!username) throw new Error("اسم المستخدم مطلوب")
  if (!/^[a-zA-Z0-9._-]{3,}$/.test(username)) {
    throw new Error("اسم المستخدم يجب أن يكون 3 أحرف على الأقل (أحرف/أرقام إنجليزية بدون مسافات)")
  }

  const existing = await findUserByUsername(username)
  if (existing && existing._id !== userId) {
    throw new Error("اسم المستخدم مُستخدم بالفعل، اختر اسماً آخر")
  }

  const base = { username, name: name ?? null, role, active, updatedAt: new Date() } as const

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

export async function deleteUser(id: string) {
  await assertManageAuthenticated()
  await db.delete(manageUsers).where(eq(manageUsers.id, uuidParam(id)))
  revalidateManage()
}

export async function toggleUserActive(id: string, value: boolean) {
  await assertManageAuthenticated()
  await db.update(manageUsers).set({ active: Boolean(value), updatedAt: new Date() }).where(eq(manageUsers.id, uuidParam(id)))
  revalidateManage()
}

/** اسم المستخدم الحالي — يُستخدم لمنع المستخدم من حذف حسابه أثناء الجلسة. */
export async function getCurrentManageUser(): Promise<string | null> {
  return getManageSessionUser()
}
