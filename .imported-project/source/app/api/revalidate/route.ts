import { revalidatePath, revalidateTag } from "next/cache"
import { type NextRequest, NextResponse } from "next/server"
import { parseBody } from "next-sanity/webhook"
import {
  SANITY_TAGS,
  brandProductsTag,
  brandTag,
  categoryProductsTag,
  categoryTag,
  productTag,
} from "@/sanity/cache-tags"

type SlugValue = string | { current?: string | null } | null
type WebhookOperation = "create" | "update" | "delete"

type WebhookPayload = {
  _id?: string
  _type?: string
  operation?: WebhookOperation
  slug?: SlugValue
  previousSlug?: SlugValue
  categorySlug?: SlugValue
  previousCategorySlug?: SlugValue
  brandSlug?: SlugValue
  previousBrandSlug?: SlugValue
  categorySlugs?: SlugValue[] | null
  previousCategorySlugs?: SlugValue[] | null
}

const SUPPORTED_TYPES = new Set([
  "product",
  "category",
  "brand",
  "ad",
  "slide",
  "review",
  "coupon",
  "shippingZone",
  "paymentAccount",
  "siteSettings",
])

/** يمنع أن يتحول السلاج القادم من الطلب إلى مسار غير مقصود. */
function readSlug(value: SlugValue | undefined): string | undefined {
  const raw = typeof value === "string" ? value : value?.current
  const slug = raw?.trim()

  if (!slug || slug.length > 180 || /[\\/?#\u0000-\u001f]/u.test(slug)) {
    return undefined
  }

  return slug
}

function readSlugList(value: SlugValue[] | null | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).map(readSlug).filter((slug): slug is string => Boolean(slug))
}

function addDynamicValues(
  values: Array<string | undefined>,
  add: (value: string) => void,
) {
  for (const value of values) {
    if (value) add(value)
  }
}

function buildRevalidationPlan(
  documentType: string,
  operation: WebhookOperation,
  body: WebhookPayload,
) {
  const tags = new Set<string>()
  const paths = new Set<string>()

  const slug = readSlug(body.slug)
  const previousSlug = readSlug(body.previousSlug)
  const categorySlug = readSlug(body.categorySlug)
  const previousCategorySlug = readSlug(body.previousCategorySlug)
  const brandSlug = readSlug(body.brandSlug)
  const previousBrandSlug = readSlug(body.previousBrandSlug)
  const categorySlugs = readSlugList(body.categorySlugs)
  const previousCategorySlugs = readSlugList(body.previousCategorySlugs)

  const slugChanged = operation !== "update" || slug !== previousSlug
  const categoryChanged = operation !== "update" || categorySlug !== previousCategorySlug
  const brandChanged = operation !== "update" || brandSlug !== previousBrandSlug

  switch (documentType) {
    case "product": {
      // القوائم التي قد تعرض أي حقل من المنتج.
      tags.add(SANITY_TAGS.products)
      tags.add(SANITY_TAGS.newProducts)
      tags.add(SANITY_TAGS.bestsellerProducts)
      tags.add(SANITY_TAGS.offerProducts)

      addDynamicValues([slug, previousSlug], (value) => tags.add(productTag(value)))
      addDynamicValues([categorySlug, previousCategorySlug], (value) =>
        tags.add(categoryProductsTag(value)),
      )
      addDynamicValues([brandSlug, previousBrandSlug], (value) =>
        tags.add(brandProductsTag(value)),
      )

      paths.add("/")
      paths.add("/categories")
      paths.add("/search")
      addDynamicValues([slug, previousSlug], (value) => paths.add(`/product/${value}`))
      addDynamicValues([categorySlug, previousCategorySlug], (value) =>
        paths.add(`/category/${value}`),
      )
      addDynamicValues([brandSlug, previousBrandSlug], (value) => paths.add(`/brand/${value}`))

      if (slugChanged) {
        tags.add(SANITY_TAGS.productSlugs)
        paths.add("/sitemap.xml")
      }

      // productCount يتغير فقط عند الإنشاء/الحذف أو نقل المنتج بين الأقسام.
      if (categoryChanged) {
        tags.add(SANITY_TAGS.categories)
        addDynamicValues([categorySlug, previousCategorySlug], (value) =>
          tags.add(categoryTag(value)),
        )
        paths.add("/shop")
      }

      // المنتج بلا براند لا يؤثر في عدادات البراندات.
      if (brandChanged && (brandSlug || previousBrandSlug)) {
        tags.add(SANITY_TAGS.brands)
        addDynamicValues([brandSlug, previousBrandSlug], (value) => tags.add(brandTag(value)))
        paths.add("/brands")
      }
      break
    }

    case "category": {
      tags.add(SANITY_TAGS.categories)
      tags.add(SANITY_TAGS.categorySlugs)
      tags.add(SANITY_TAGS.categoryReferences)
      addDynamicValues([slug, previousSlug], (value) => {
        tags.add(categoryTag(value))
        tags.add(categoryProductsTag(value))
      })

      paths.add("/")
      paths.add("/shop")
      paths.add("/categories")
      paths.add("/search")
      paths.add("/sitemap.xml")
      addDynamicValues([slug, previousSlug], (value) => paths.add(`/category/${value}`))
      break
    }

    case "brand": {
      tags.add(SANITY_TAGS.brands)
      tags.add(SANITY_TAGS.brandSlugs)
      tags.add(SANITY_TAGS.brandReferences)
      addDynamicValues([slug, previousSlug], (value) => {
        tags.add(brandTag(value))
        tags.add(brandProductsTag(value))
      })

      paths.add("/")
      paths.add("/brands")
      paths.add("/categories")
      paths.add("/search")
      paths.add("/sitemap.xml")
      addDynamicValues([slug, previousSlug], (value) => paths.add(`/brand/${value}`))
      break
    }

    case "ad": {
      tags.add(SANITY_TAGS.ads)
      paths.add("/categories")
      addDynamicValues([...categorySlugs, ...previousCategorySlugs], (value) =>
        paths.add(`/category/${value}`),
      )
      break
    }

    case "slide":
      tags.add(SANITY_TAGS.slides)
      paths.add("/")
      break

    case "review":
      tags.add(SANITY_TAGS.reviews)
      paths.add("/")
      break

    case "coupon":
      tags.add(SANITY_TAGS.coupons)
      paths.add("/checkout")
      break

    case "shippingZone":
      tags.add(SANITY_TAGS.shippingZones)
      paths.add("/checkout")
      break

    // حسابات الدفع تظهر في صفحة إتمام الطلب فقط.
    case "paymentAccount":
      tags.add(SANITY_TAGS.paymentAccounts)
      paths.add("/checkout")
      break

    case "siteSettings":
      // تغيير العملات أو أسعار الصرف يؤثر على كل صفحة تعرض أسعاراً
      tags.add(SANITY_TAGS.settings)
      paths.add("/")
      break
  }

  return {
    tags: [...tags].sort(),
    paths: [...paths].sort(),
  }
}

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.SANITY_REVALIDATE_SECRET?.trim()

    if (!secret) {
      return NextResponse.json(
        { error: "Missing SANITY_REVALIDATE_SECRET environment variable" },
        { status: 500 },
      )
    }

    // true ينتظر اتساق Content Lake قبل إبطال الكاش حتى لا تُجلب نسخة قديمة.
    const { isValidSignature, body } = await parseBody<WebhookPayload>(req, secret, true)

    if (!isValidSignature) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }

    if (!body?._type) {
      return NextResponse.json(
        { error: "Missing _type. Configure the webhook projection from SANITY-WEBHOOK-GUIDE.md" },
        { status: 400 },
      )
    }

    if (!SUPPORTED_TYPES.has(body._type)) {
      return NextResponse.json({ revalidated: false, ignoredType: body._type }, { status: 202 })
    }

    const headerOperation = req.headers.get("sanity-operation")
    const operation: WebhookOperation =
      body.operation === "create" || body.operation === "delete" || body.operation === "update"
        ? body.operation
        : headerOperation === "create" || headerOperation === "delete" || headerOperation === "update"
          ? headerOperation
          : "update"

    const plan = buildRevalidationPlan(body._type, operation, body)

    // Webhooks تحتاج انتهاءً فورياً؛ profile="max" قد يعرض النسخة القديمة لأول زائر.
    for (const tag of plan.tags) {
      revalidateTag(tag, { expire: 0 })
    }

    // إبطال Full Route Cache للمسارات المباشرة القديمة وال��ديدة عند تغيير السلاج.
    for (const path of plan.paths) {
      revalidatePath(path)
    }

    return NextResponse.json({
      revalidated: true,
      documentId: body._id ?? req.headers.get("sanity-document-id"),
      documentType: body._type,
      operation,
      tags: plan.tags,
      paths: plan.paths,
      now: Date.now(),
    })
  } catch (error) {
    console.error("[revalidate] webhook error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
