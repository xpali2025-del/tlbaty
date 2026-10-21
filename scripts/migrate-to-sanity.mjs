/**
 * سكربت الترحيل إلى Sanity CMS
 * ---------------------------------
 * يرحّل كل بيانات JSON السابقة (المنتجات، الأقسام، البراندات، السلايدر،
 * الكوبونات، التقييمات، الإعلانات) إلى Sanity، ويرفع كل الصور من مجلد
 * public إلى Sanity Image CDN.
 *
 * الاستخدام (بعد تعبئة متغيرات البيئة):
 *   node scripts/migrate-to-sanity.mjs
 *
 * متغيرات البيئة المطلوبة:
 *   NEXT_PUBLIC_SANITY_PROJECT_ID
 *   NEXT_PUBLIC_SANITY_DATASET      (مثال: production)
 *   SANITY_API_TOKEN                (توكن بصلاحية Editor أو أعلى)
 *
 * السكربت آمن لإعادة التشغيل (idempotent):
 *   - يستخدم معرّفات ثابتة (createOrReplace) فلا تتكرر المستندات.
 *   - يعيد استخدام الصور المرفوعة سابقاً عبر التخزين المؤقت المحلي.
 */

import { createClient } from "@sanity/client"
import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const DATA_DIR = path.join(__dirname, "migration", "data")
const PUBLIC_DIR = path.join(ROOT, "public")
const UPLOAD_CACHE_FILE = path.join(__dirname, "migration", ".upload-cache.json")

// ---------- إعداد العميل ----------
const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production"
const token = process.env.SANITY_API_TOKEN

if (!projectId || !token) {
  console.error(
    "\n❌ متغيرات البيئة ناقصة. المطلوب: NEXT_PUBLIC_SANITY_PROJECT_ID و SANITY_API_TOKEN\n" +
      "   مثال للتشغيل:\n" +
      "   NEXT_PUBLIC_SANITY_PROJECT_ID=xxxx SANITY_API_TOKEN=sk... node scripts/migrate-to-sanity.mjs\n",
  )
  process.exit(1)
}

const client = createClient({
  projectId,
  dataset,
  apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2026-01-01",
  token,
  useCdn: false, // الكتابة يجب أن تتم عبر الـ API المباشر وليس الـ CDN
})

// ---------- أدوات مساعدة ----------
const readJson = (file) => JSON.parse(readFileSync(path.join(DATA_DIR, file), "utf8"))

/** تخزين مؤقت لأصول الصور المرفوعة: { "/products/x.jpg": "image-abc123..." } */
let uploadCache = {}
if (existsSync(UPLOAD_CACHE_FILE)) {
  try {
    uploadCache = JSON.parse(readFileSync(UPLOAD_CACHE_FILE, "utf8"))
  } catch {
    uploadCache = {}
  }
}
const saveCache = () => writeFileSync(UPLOAD_CACHE_FILE, JSON.stringify(uploadCache, null, 2))

/** رفع صورة من public وإرجاع مرجع الأصل، أو undefined إذا كانت الصورة مفقودة */
async function uploadImage(publicPath) {
  if (!publicPath) return undefined
  if (uploadCache[publicPath]) {
    return { _type: "image", asset: { _type: "reference", _ref: uploadCache[publicPath] } }
  }
  const filePath = path.join(PUBLIC_DIR, publicPath.replace(/^\//, ""))
  if (!existsSync(filePath)) {
    console.warn(`   ⚠️  صورة مفقودة (سيتم تخطيها): ${publicPath}`)
    return undefined
  }
  const asset = await client.assets.upload("image", createReadStream(filePath), {
    filename: path.basename(filePath),
  })
  uploadCache[publicPath] = asset._id
  saveCache()
  console.log(`   ⬆️  رفع صورة: ${publicPath}`)
  return { _type: "image", asset: { _type: "reference", _ref: asset._id } }
}

const slugField = (value) => ({ _type: "slug", current: value })
const ref = (id) => ({ _type: "reference", _ref: id })
const key = (prefix, i) => `${prefix}-${i}`

// ---------- الترحيل ----------
async function migrate() {
  console.log(`\n🚀 بدء الترحيل إلى Sanity (project: ${projectId}, dataset: ${dataset})\n`)

  // 1) الأقسام
  const { categories } = readJson("categories.json")
  console.log(`📁 ترحيل ${categories.length} قسم...`)
  for (const [i, c] of categories.entries()) {
    const image = await uploadImage(c.image)
    await client.createOrReplace({
      _id: `category-${c.slug}`,
      _type: "category",
      name: c.name,
      slug: slugField(c.slug),
      ...(image ? { image } : {}),
      description: c.description,
      metaTitle: c.metaTitle,
      metaDescription: c.metaDescription,
      keywords: c.keywords || [],
      sortOrder: i,
      subcategories: (c.subcategories || []).map((s, j) => ({
        _type: "subcategory",
        _key: key(s.slug, j),
        name: s.name,
        slug: slugField(s.slug),
        description: s.description,
      })),
    })
    console.log(`   ✅ ${c.name}`)
  }

  // 2) البراندات
  const { brands } = readJson("brands.json")
  console.log(`\n🏷️  ترحيل ${brands.length} براند...`)
  /** خريطة اسم البراند -> معرّف المستند (لربط المنتجات) */
  const brandIdByName = new Map()
  for (const [i, b] of brands.entries()) {
    const image = await uploadImage(b.image)
    const _id = `brand-${b.slug}`
    brandIdByName.set(b.name.trim(), _id)
    await client.createOrReplace({
      _id,
      _type: "brand",
      name: b.name,
      slug: slugField(b.slug),
      ...(image ? { image } : {}),
      description: b.description,
      featured: Boolean(b.featured),
      metaTitle: b.metaTitle,
      metaDescription: b.metaDescription,
      keywords: b.keywords || [],
      sortOrder: i,
    })
    console.log(`   ✅ ${b.name}`)
  }

  // 3) المنتجات (كل ملف JSON في مجلد products)
  const productFiles = readdirSync(path.join(DATA_DIR, "products")).filter((f) => f.endsWith(".json"))
  console.log(`\n📦 ترحيل ${productFiles.length} منتج...`)
  for (const [i, file] of productFiles.entries()) {
    const p = JSON.parse(readFileSync(path.join(DATA_DIR, "products", file), "utf8"))

    const mainImage = await uploadImage(p.image)
    const galleryImages = []
    for (const [j, img] of (p.images || []).entries()) {
      const uploaded = await uploadImage(img)
      if (uploaded) galleryImages.push({ ...uploaded, _key: key("img", j) })
    }

    const brandId = p.brand ? brandIdByName.get(p.brand.trim()) : undefined
    if (p.brand && !brandId) {
      console.warn(`   ⚠️  براند غير معروف "${p.brand}" في المنتج ${p.slug} — سيُترك بدون براند`)
    }

    await client.createOrReplace({
      _id: `product-${p.slug}`,
      _type: "product",
      productId: p.id,
      name: p.name,
      slug: slugField(p.slug),
      description: p.description,
      price: p.price,
      ...(p.oldPrice != null ? { oldPrice: p.oldPrice } : {}),
      category: ref(`category-${p.category}`),
      ...(p.subcategory ? { subcategory: p.subcategory } : {}),
      ...(brandId ? { brand: ref(brandId) } : {}),
      ...(mainImage ? { mainImage } : {}),
      images: galleryImages,
      colors: (p.colors || []).map((c, j) => ({
        _type: "colorOption",
        _key: key("color", j),
        name: c.name,
        hex: c.hex,
      })),
      sizes: p.sizes || [],
      stock: p.stock ?? 0,
      rating: p.rating ?? 5,
      reviewsCount: p.reviewsCount ?? 0,
      isNew: Boolean(p.isNew) || (p.tags || []).includes("new"),
      isBestseller: Boolean(p.isBestseller) || (p.tags || []).includes("bestseller"),
      ...(p.badge ? { badge: p.badge } : {}),
      tags: p.tags || [],
      ...(p.sku ? { sku: p.sku } : {}),
      sortOrder: i,
      metaTitle: p.metaTitle,
      metaDescription: p.metaDescription,
      keywords: p.keywords || [],
    })
    console.log(`   ✅ [${i + 1}/${productFiles.length}] ${p.name}`)
  }

  // 4) السلايدر
  const { slides } = readJson("slider.json")
  console.log(`\n🖼️  ترحيل ${slides.length} شريحة...`)
  for (const [i, s] of slides.entries()) {
    const image = await uploadImage(s.image)
    await client.createOrReplace({
      _id: `slide-${s.id}`,
      _type: "slide",
      title: s.title,
      subtitle: s.subtitle,
      cta: s.cta,
      href: s.href,
      ...(image ? { image } : {}),
      sortOrder: i,
    })
    console.log(`   ✅ ${s.title}`)
  }

  // 5) الكوبونات
  const { coupons } = readJson("coupons.json")
  console.log(`\n🎟️  ترحيل ${coupons.length} كوبون...`)
  for (const c of coupons) {
    await client.createOrReplace({
      _id: `coupon-${c.code.toLowerCase()}`,
      _type: "coupon",
      code: c.code,
      discount: c.discount,
      type: c.type,
      minOrder: c.minOrder ?? 0,
      description: c.description,
    })
    console.log(`   ✅ ${c.code}`)
  }

  // 6) التقييمات
  const { reviews } = readJson("reviews.json")
  console.log(`\n⭐ ترحيل ${reviews.length} تقييم...`)
  for (const r of reviews) {
    await client.createOrReplace({
      _id: `review-${r.id}`,
      _type: "review",
      name: r.name,
      rating: r.rating,
      comment: r.comment,
      date: r.date,
    })
    console.log(`   ✅ ${r.name}`)
  }

  // 7) الإعلانات — قيمة "all" تعني كل الأقسام => مصفوفة فارغة
  const { ads } = readJson("ads.json")
  console.log(`\n📢 ترحيل ${ads.length} إعلان...`)
  for (const [i, a] of ads.entries()) {
    const image = await uploadImage(a.image)
    const categoryRefs = (a.categories || [])
      .filter((slug) => slug !== "all")
      .map((slug, j) => ({ ...ref(`category-${slug}`), _key: key("cat", j) }))
    await client.createOrReplace({
      _id: `ad-${a.id}`,
      _type: "ad",
      title: a.title,
      ...(image ? { image } : {}),
      href: a.href,
      categories: categoryRefs,
      active: a.active !== false,
      frequency: a.frequency ?? 6,
      sortOrder: a.order ?? i,
    })
    console.log(`   ✅ ${a.title}`)
  }

  console.log("\n🎉 اكتمل الترحيل بنجاح! افتح /studio لمراجعة المحتوى.\n")
}

migrate().catch((err) => {
  console.error("\n❌ فشل الترحيل:", err.message || err)
  process.exit(1)
})
