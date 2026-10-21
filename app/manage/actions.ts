"use server"

import { generateText } from "ai"
import { revalidatePath, revalidateTag } from "next/cache"
import { requireWriteClient } from "@/sanity/write-client"
import { SANITY_TAGS } from "@/sanity/cache-tags"
import { assertManageAuthenticated, getManageSessionUser } from "@/lib/manage-auth"
import { findUserByUsername, hashPassword } from "@/lib/manage-users"

// ============================================
// إجراءات لوحة الإدارة (/manage)
// كل إجراء يكتب مباشرة في Sanity عبر توكن الكتابة، ثم يبطل كاش المتجر
// حتى تظهر التغييرات فوراً — تماماً كأن Sanity هو من أضافها.
// ============================================

// ---------- أدوات مساعدة ----------

type ImageRef = { _type: "image"; asset: { _type: "reference"; _ref: string } }

/** تحويل نص عربي/إنجليزي إلى سلاج آمن. */
function slugify(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
      .replace(/^-+|-+$/g, "") || `item-${Date.now().toString(36)}`
  )
}

/** تنظيف نص لاتيني إلى سلاج إنجليزي آمن (حروف/أرقام وشرطات فقط). */
function englishSlug(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `item-${Date.now().toString(36)}`
  )
}

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
    // ضمان عدم إرجاع سلاج فارغ إذا رد النموذج بشيء غير متوقع.
    return slug || englishSlug(parts.join("-"))
  } catch {
    // في حال تعذّر الاتصال بالنموذج، نرجع سلاجاً من النص كما هو.
    return englishSlug(parts.join("-"))
  }
}

/** رمز قصير من نص (3 أحرف لاتينية) لاستخدامه في رقم المنتج. */
function shortCode(value: string, fallback: string): string {
  const ascii = value.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return ascii.slice(0, 3) || fallback
}

function makeProductId(categorySlug: string, subcategory?: string): string {
  const suffix = Math.random().toString(36).slice(2, 10).toUpperCase()
  const cat = shortCode(categorySlug, "CAT")
  const sub = subcategory ? `-${shortCode(subcategory, "SUB")}` : ""
  return `TRF-${cat}${sub}-${suffix}`
}

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key)
  if (typeof v !== "string") return undefined
  const trimmed = v.trim()
  return trimmed.length ? trimmed : undefined
}

function num(form: FormData, key: string): number | undefined {
  const v = str(form, key)
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function bool(form: FormData, key: string): boolean {
  return form.get(key) === "true" || form.get(key) === "on"
}

/** يقرأ حقل JSON من النموذج (للمصفوفات مثل الألوان والكلمات المفتاحية). */
function json<T>(form: FormData, key: string, fallback: T): T {
  const raw = str(form, key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** يرفع صورة من النموذج إلى Sanity ويعيد مرجع الأصل، أو undefined. */
async function uploadImage(form: FormData, key = "image"): Promise<ImageRef | undefined> {
  const file = form.get(key)
  if (!(file instanceof File) || file.size === 0) return undefined
  const client = requireWriteClient()
  const buffer = Buffer.from(await file.arrayBuffer())
  const asset = await client.assets.upload("image", buffer, { filename: file.name })
  return { _type: "image", asset: { _type: "reference", _ref: asset._id } }
}

/** يرفع كل الصور المرسلة تحت مفتاح واحد ويعيد قائمة مراجع الأصول. */
async function uploadImages(form: FormData, key: string): Promise<ImageRef[]> {
  const files = form.getAll(key).filter((f): f is File => f instanceof File && f.size > 0)
  if (!files.length) return []
  const client = requireWriteClient()
  const refs: ImageRef[] = []
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const asset = await client.assets.upload("image", buffer, { filename: file.name })
    refs.push({ _type: "image", asset: { _type: "reference", _ref: asset._id } })
  }
  return refs
}

/**
 * يبني مصفوفة الصور الإضافية للمنتج من:
 * - مراجع الصور الحالية التي أبقاها المستخدم (keptImages)
 * - الصور الجديدة المرفوعة (newImages)
 */
async function buildProductImages(form: FormData) {
  const keptRefs = json<string[]>(form, "keptImages", [])
  const uploaded = await uploadImages(form, "newImages")
  return [
    ...keptRefs.map((refId, i) => ({
      _type: "image" as const,
      _key: `img-keep-${i}`,
      asset: { _type: "reference" as const, _ref: refId },
    })),
    ...uploaded.map((img, i) => ({ ...img, _key: `img-new-${Date.now().toString(36)}-${i}` })),
  ]
}

function ref(id: string) {
  return { _type: "reference" as const, _ref: id }
}

/**
 * إبطال كاش المتجر بالكامل بعد أي كتابة. عمليات الإدارة نادرة نسبياً،
 * لذا نبطل كل الوسوم ومسارات الجذر لضمان ظهور التغيير فوراً في كل الصفحات.
 */
function revalidateStore() {
  for (const tag of Object.values(SANITY_TAGS)) {
    revalidateTag(tag, { expire: 0 })
  }
  revalidatePath("/", "layout")
}

// ============================================
// المنتجات
// ============================================

export async function saveProduct(id: string | null, form: FormData) {
  await assertManageAuthenticated()
  const client = requireWriteClient()

  const name = str(form, "name")
  const categoryId = str(form, "categoryId")
  const price = num(form, "price")
  if (!name) throw new Error("اسم المنتج مطلوب")
  if (!categoryId) throw new Error("اختر القسم الرئيسي للمنتج")
  if (price === undefined) throw new Error("أدخل سعراً صحيحاً")

  const subcategory = str(form, "subcategory")
  const brandId = str(form, "brandId")
  const categorySlug = str(form, "categorySlug") ?? slugify(name)
  // رابط المنتج: يكتبه صاحب المتجر يدوياً، وإن تُرك فارغاً يُشتق من الاسم.
  const slug = slugify(str(form, "slug") ?? name)
  const image = await uploadImage(form)
  const images = await buildProductImages(form)

  const colors = json<{ name: string; hex: string }[]>(form, "colors", []).map((c, i) => ({
    _type: "colorOption",
    _key: `color-${i}`,
    name: c.name,
    hex: c.hex,
  }))
  const sizes = json<string[]>(form, "sizes", [])
  const keywords = json<string[]>(form, "keywords", [])

  const base: Record<string, unknown> = {
    name,
    slug: { _type: "slug", current: slug },
    description: str(form, "description"),
    price,
    oldPrice: num(form, "oldPrice") ?? null,
    category: ref(categoryId),
    subcategory: subcategory ?? null,
    brand: brandId ? ref(brandId) : null,
    stock: num(form, "stock") ?? 0,
    isNew: bool(form, "isNew"),
    isBestseller: bool(form, "isBestseller"),
    badge: str(form, "badge") ?? null,
    sortOrder: num(form, "sortOrder") ?? 0,
    sku: str(form, "sku") ?? null,
    metaTitle: str(form, "metaTitle") ?? null,
    metaDescription: str(form, "metaDescription") ?? null,
    colors,
    sizes,
    keywords,
    images,
  }

  if (id) {
    const patch = client.patch(id).set(base)
    if (image) patch.set({ mainImage: image })
    await patch.commit()
  } else {
    await client.create({
      _type: "product",
      productId: makeProductId(categorySlug, subcategory),
      rating: 5,
      reviewsCount: 0,
      tags: [],
      ...(image ? { mainImage: image } : {}),
      ...base,
    })
  }

  revalidateStore()
}

export async function deleteProduct(id: string) {
  await assertManageAuthenticated()
  await requireWriteClient().delete(id)
  revalidateStore()
}

export async function toggleProductFlag(id: string, field: "isNew" | "isBestseller", value: boolean) {
  await assertManageAuthenticated()
  await requireWriteClient().patch(id).set({ [field]: value }).commit()
  revalidateStore()
}

// ============================================
// الأقسام
// ============================================

export async function saveCategory(id: string | null, form: FormData) {
  await assertManageAuthenticated()
  const client = requireWriteClient()

  const name = str(form, "name")
  if (!name) throw new Error("اسم القسم مطلوب")

  // رابط القسم: يكتبه صاحب المتجر يدوياً، وإن تُرك فارغاً يُشتق من الاسم.
  const slug = slugify(str(form, "slug") ?? name)
  const image = await uploadImage(form)
  const keywords = json<string[]>(form, "keywords", [])
  const subcategories = json<{ name: string; slug?: string; description?: string }[]>(
    form,
    "subcategories",
    [],
  ).map((s, i) => {
    // كل قسم فرعي يمكن أن يكون له رابط مخصّص، وإلا يُشتق من اسمه.
    const subSlug = slugify(s.slug || s.name)
    return {
      _type: "subcategory",
      _key: `sub-${i}-${subSlug}`,
      name: s.name,
      slug: { _type: "slug", current: subSlug },
      description: s.description || undefined,
    }
  })

  const base: Record<string, unknown> = {
    name,
    slug: { _type: "slug", current: slug },
    description: str(form, "description") ?? null,
    sortOrder: num(form, "sortOrder") ?? 0,
    metaTitle: str(form, "metaTitle") ?? null,
    metaDescription: str(form, "metaDescription") ?? null,
    keywords,
    subcategories,
  }

  if (id) {
    const patch = client.patch(id).set(base)
    if (image) patch.set({ image })
    await patch.commit()
  } else {
    await client.create({
      _type: "category",
      ...(image ? { image } : {}),
      ...base,
    })
  }

  revalidateStore()
}

export async function deleteCategory(id: string) {
  await assertManageAuthenticated()
  const client = requireWriteClient()
  const count = await client.fetch<number>(
    `count(*[_type == "product" && references($id)])`,
    { id },
  )
  if (count > 0) {
    throw new Error(`لا يمكن حذف القسم لوجود ${count} منتج مرتبط به. انقل المنتجات أولاً.`)
  }
  await client.delete(id)
  revalidateStore()
}

// ============================================
// البراندات
// ============================================

export async function saveBrand(id: string | null, form: FormData) {
  await assertManageAuthenticated()
  const client = requireWriteClient()

  const name = str(form, "name")
  if (!name) throw new Error("اسم البراند مطلوب")

  // رابط البراند: يكتبه صاحب المتجر يدوياً، وإن تُرك فارغاً يُشتق من الاسم.
  const slug = slugify(str(form, "slug") ?? name)
  const image = await uploadImage(form)
  const keywords = json<string[]>(form, "keywords", [])

  const base: Record<string, unknown> = {
    name,
    slug: { _type: "slug", current: slug },
    description: str(form, "description") ?? null,
    featured: bool(form, "featured"),
    sortOrder: num(form, "sortOrder") ?? 0,
    metaTitle: str(form, "metaTitle") ?? null,
    metaDescription: str(form, "metaDescription") ?? null,
    keywords,
  }

  if (id) {
    const patch = client.patch(id).set(base)
    if (image) patch.set({ image })
    await patch.commit()
  } else {
    await client.create({
      _type: "brand",
      ...(image ? { image } : {}),
      ...base,
    })
  }

  revalidateStore()
}

export async function deleteBrand(id: string) {
  await assertManageAuthenticated()
  await requireWriteClient().delete(id)
  revalidateStore()
}

// ============================================
// السلايدر
// ============================================

export async function saveSlide(id: string | null, form: FormData) {
  await assertManageAuthenticated()
  const client = requireWriteClient()

  const title = str(form, "title")
  if (!title) throw new Error("عنوان السلايد مطلوب")

  const image = await uploadImage(form)

  const base: Record<string, unknown> = {
    title,
    subtitle: str(form, "subtitle") ?? null,
    cta: str(form, "cta") ?? null,
    href: str(form, "href") ?? "/",
    sortOrder: num(form, "sortOrder") ?? 0,
  }

  if (id) {
    const patch = client.patch(id).set(base)
    if (image) patch.set({ image })
    await patch.commit()
  } else {
    if (!image) throw new Error("صورة السلايد مطلوبة")
    await client.create({ _type: "slide", image, ...base })
  }

  revalidateStore()
}

export async function deleteSlide(id: string) {
  await assertManageAuthenticated()
  await requireWriteClient().delete(id)
  revalidateStore()
}

// ============================================
// أكواد الخصم
// ============================================

export async function saveCoupon(id: string | null, form: FormData) {
  await assertManageAuthenticated()
  const client = requireWriteClient()

  const code = str(form, "code")
  const discount = num(form, "discount")
  const description = str(form, "description")
  const type = str(form, "type") === "percent" ? "percent" : "fixed"
  if (!code) throw new Error("كود الخصم مطلوب")
  if (discount === undefined) throw new Error("قيمة الخصم مطلوبة")
  if (!description) throw new Error("وصف الكوبون مطلوب")

  const base = {
    code: code.toUpperCase(),
    discount,
    type,
    minOrder: num(form, "minOrder") ?? 0,
    description,
  }

  if (id) {
    await client.patch(id).set(base).commit()
  } else {
    await client.create({ _type: "coupon", ...base })
  }

  revalidateStore()
}

export async function deleteCoupon(id: string) {
  await assertManageAuthenticated()
  await requireWriteClient().delete(id)
  revalidateStore()
}

// ============================================
// آراء العملاء
// ============================================

export async function saveReview(id: string | null, form: FormData) {
  await assertManageAuthenticated()
  const client = requireWriteClient()

  const name = str(form, "name")
  const comment = str(form, "comment")
  const rating = num(form, "rating") ?? 5
  if (!name) throw new Error("اسم العميل مطلوب")
  if (!comment) throw new Error("نص التقييم مطلوب")

  const image = await uploadImage(form, "avatar")
  const base: Record<string, unknown> = {
    name,
    comment,
    rating: Math.min(5, Math.max(1, rating)),
    date: str(form, "date") ?? new Date().toISOString().slice(0, 10),
  }

  if (id) {
    const patch = client.patch(id).set(base)
    if (image) patch.set({ avatar: image })
    await patch.commit()
  } else {
    await client.create({ _type: "review", ...(image ? { avatar: image } : {}), ...base })
  }

  revalidateStore()
}

export async function deleteReview(id: string) {
  await assertManageAuthenticated()
  await requireWriteClient().delete(id)
  revalidateStore()
}

// ============================================
// الإعلانات
// ============================================

export async function saveAd(id: string | null, form: FormData) {
  await assertManageAuthenticated()
  const client = requireWriteClient()

  const title = str(form, "title")
  if (!title) throw new Error("اسم الإعلان مطلوب")

  const image = await uploadImage(form)
  const categoryIds = json<string[]>(form, "categoryIds", [])
  const categories = categoryIds.map((cid, i) => ({ ...ref(cid), _key: `cat-${i}` }))

  const base: Record<string, unknown> = {
    title,
    href: str(form, "href") ?? null,
    active: bool(form, "active"),
    frequency: num(form, "frequency") ?? 6,
    sortOrder: num(form, "sortOrder") ?? 0,
    categories,
  }

  if (id) {
    const patch = client.patch(id).set(base)
    if (image) patch.set({ image })
    await patch.commit()
  } else {
    if (!image) throw new Error("صورة الإعلان مطلوبة")
    await client.create({ _type: "ad", image, ...base })
  }

  revalidateStore()
}

export async function toggleAdActive(id: string, value: boolean) {
  await assertManageAuthenticated()
  await requireWriteClient().patch(id).set({ active: value }).commit()
  revalidateStore()
}

export async function deleteAd(id: string) {
  await assertManageAuthenticated()
  await requireWriteClient().delete(id)
  revalidateStore()
}

// ============================================
// إعدادات الموقع (مستند مفرد)
// ============================================

export async function saveSettings(id: string | null, form: FormData) {
  await assertManageAuthenticated()
  const client = requireWriteClient()

  const logo = await uploadImage(form, "logo")
  const base: Record<string, unknown> = {
    name: str(form, "name") ?? null,
    tagline: str(form, "tagline") ?? null,
    description: str(form, "description") ?? null,
    phone: str(form, "phone") ?? null,
    whatsapp: str(form, "whatsapp") ?? null,
    email: str(form, "email") ?? null,
    address: str(form, "address") ?? null,
    workingHours: str(form, "workingHours") ?? null,
    copyright: str(form, "copyright") ?? null,
    social: {
      instagram: str(form, "instagram") ?? null,
      facebook: str(form, "facebook") ?? null,
      tiktok: str(form, "tiktok") ?? null,
    },
  }

  const docId = id ?? "siteSettings"
  await client
    .createIfNotExists({ _id: docId, _type: "siteSettings" })
    .then(() => {
      const patch = client.patch(docId).set(base)
      if (logo) patch.set({ logo })
      return patch.commit()
    })

  revalidateStore()
}

// ============================================
// المستخدمون (حسابات الدخول للوحة)
// ============================================

/** إبطال كاش صفحة اللوحة فقط حتى تُحدَّث قائمة المستخدمين فوراً. */
function revalidateManage() {
  revalidatePath("/manage")
}

export async function saveUser(id: string | null, form: FormData) {
  await assertManageAuthenticated()
  const client = requireWriteClient()

  const username = str(form, "username")
  const password = str(form, "password")
  const name = str(form, "name")
  const role = str(form, "role") === "admin" ? "admin" : "editor"
  const active = bool(form, "active")

  if (!username) throw new Error("اسم المستخدم مطلوب")
  if (!/^[a-zA-Z0-9._-]{3,}$/.test(username)) {
    throw new Error("اسم المستخدم يجب أن يكون 3 أحرف على الأقل (أحرف/أرقام إنجليزية بدون مسافات)")
  }

  // منع تكرار اسم المستخدم.
  const existing = await findUserByUsername(username)
  if (existing && existing._id !== id) {
    throw new Error("اسم المستخدم مُستخدم بالفعل، اختر اسماً آخر")
  }

  const base: Record<string, unknown> = { username, name: name ?? null, role, active }

  if (id) {
    const patch = client.patch(id).set(base)
    // كلمة المرور اختيارية عند التعديل — تُحدَّث فقط إذا أُدخلت.
    if (password) {
      if (password.length < 6) throw new Error("كلمة المرور يجب أن تكون 6 أحرف على الأقل")
      patch.set({ passwordHash: hashPassword(password) })
    }
    await patch.commit()
  } else {
    if (!password || password.length < 6) {
      throw new Error("كلمة المرور مطلوبة (6 أحرف على الأقل)")
    }
    await client.create({ _type: "manageUser", passwordHash: hashPassword(password), ...base })
  }

  revalidateManage()
}

export async function deleteUser(id: string) {
  await assertManageAuthenticated()
  await requireWriteClient().delete(id)
  revalidateManage()
}

export async function toggleUserActive(id: string, value: boolean) {
  await assertManageAuthenticated()
  await requireWriteClient().patch(id).set({ active: value }).commit()
  revalidateManage()
}

/** اسم المستخدم الحالي — يُستخدم لمنع المستخدم من حذف حسابه أثناء الجلسة. */
export async function getCurrentManageUser(): Promise<string | null> {
  return getManageSessionUser()
}
