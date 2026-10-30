import "server-only"

import { cache } from "react"
import { db } from "@/lib/db/client"
import { siteSettings } from "@/lib/db/store"
import { CACHE_TAGS } from "@/lib/cache-tags"
import { dbCached, isDbConfigured } from "@/lib/db-cache"
import { resolveOptionalImageUrl } from "@/lib/images"
import { SITE_CONFIG } from "@/lib/site"

// ============================================
// إعدادات المتجر الحيّة: ما يُدار من لوحة الإدارة (الاسم، الشعار، الشعار النصي، أرقام التواصل،
// روابط التواصل الاجتماعي، طرق الدفع) يُدمج فوق القيم الثابتة في lib/site.ts.
//
// - بلا صف إعدادات في القاعدة: القيم الثابتة كما هي (المتجر يعمل بلا ضبط).
// - مع صف إعدادات: حقول الاتصال والروابط تُؤخذ كما حفظها المدير (الفارغ يعني إخفاؤه، لا الرجوع للافتراضي)،
//   أما الاسم والوصف والشعار النصي فيرجع الفارغ منها للافتراضي لأنها لا تُترك فارغة.
// - الكاش بوسم settings، ويبطله حفظ الإعدادات (revalidateStore).
// ============================================

export type SiteConfig = Omit<typeof SITE_CONFIG, "name" | "nameEn" | "tagline" | "description" | "contact" | "social" | "footer"> & {
  name: string
  nameEn: string
  tagline: string
  description: string
  contact: { phone: string; phoneDisplay: string; secondaryPhone: string; whatsapp: string; email: string; address: string; addressFull: string; workingHours: string }
  social: { whatsapp: string; instagram: string; facebook: string; tiktok: string; x: string; youtube: string; snapchat: string; telegram: string }
  footer: { copyright: string; credit: string }
  /** رابط الشعار المرفوع، أو null لاستخدام الشعار الافتراضي. */
  logoUrl: string | null
  /** طرق الدفع المفعّلة من اللوحة. */
  payments: { cashOnDelivery: boolean; manualTransfer: boolean; wallet: boolean }
}

type Row = typeof siteSettings.$inferSelect

const clean = (v: string | null | undefined) => (v ?? "").trim()

/** رقم دولي بأرقام فقط (للروابط wa.me)، يُقبل بأي تنسيق: +967 77…، 00967…، 0777…؟ */
export function whatsappDigits(input: string): string {
  const digits = input.replace(/\D/g, "").replace(/^00/, "")
  return digits
}

function socialUrl(value: string, base: string): string {
  const v = value.trim()
  if (!v) return ""
  if (/^https?:\/\//i.test(v)) return v
  return `${base}${v.replace(/^@/, "")}`
}

export function mergeSiteConfig(row: Row | null): SiteConfig {
  const d = SITE_CONFIG
  if (!row) {
    return { ...d, contact: { ...d.contact, secondaryPhone: "" }, social: { ...d.social, x: "", youtube: "", snapchat: "", telegram: "" }, footer: { ...d.footer }, logoUrl: null, payments: { cashOnDelivery: true, manualTransfer: true, wallet: true } }
  }
  const phone = clean(row.phone)
  const whatsapp = whatsappDigits(clean(row.whatsapp))
  const address = clean(row.address)
  const name = clean(row.name) || d.name
  return {
    ...d,
    name,
    nameEn: clean(row.nameEn) || d.nameEn,
    tagline: clean(row.tagline) || d.tagline,
    description: clean(row.description) || d.description,
    contact: {
      phone: phone.replace(/\s+/g, ""),
      phoneDisplay: phone,
      secondaryPhone: clean(row.secondaryPhone),
      whatsapp,
      email: clean(row.email),
      address,
      addressFull: address,
      workingHours: clean(row.workingHours),
    },
    social: {
      whatsapp: whatsapp ? `https://wa.me/${whatsapp}` : "",
      instagram: socialUrl(clean(row.instagram), "https://instagram.com/"),
      facebook: socialUrl(clean(row.facebook), "https://facebook.com/"),
      tiktok: socialUrl(clean(row.tiktok), "https://tiktok.com/@"),
      x: socialUrl(clean(row.x), "https://x.com/"),
      youtube: socialUrl(clean(row.youtube), "https://youtube.com/@"),
      snapchat: socialUrl(clean(row.snapchat), "https://snapchat.com/add/"),
      telegram: socialUrl(clean(row.telegram), "https://t.me/"),
    },
    footer: { copyright: clean(row.copyright) || `© ${new Date().getFullYear()} جميع الحقوق محفوظة - ${name}`, credit: d.footer.credit },
    logoUrl: resolveOptionalImageUrl(row.logoKey) ?? null,
    // نسخة كاش قديمة (قبل إضافة العمود) قد لا تحمل walletEnabled: نعتبره مفعّلاً كالافتراضي.
    payments: { cashOnDelivery: row.codEnabled, manualTransfer: row.transferEnabled, wallet: row.walletEnabled ?? true },
  }
}

const loadRow = (): Promise<Row | null> =>
  dbCached<Row | null>({
    keyParts: ["store", "site-settings"],
    tags: [CACHE_TAGS.settings],
    fallback: null,
    load: async () => (await db.select().from(siteSettings).limit(1))[0] ?? null,
  })

/** إعدادات المتجر المدموجة. تُخزَّن لطلب واحد (React cache) وفي Data Cache بوسم settings. */
export const getSiteConfig = cache(async (): Promise<SiteConfig> => mergeSiteConfig(await loadRow()))

/** ما يحتاجه المتصفح فقط (لا JSON-LD ولا مفاتيح): يُمرَّر إلى SiteConfigProvider. */
export type PublicSiteConfig = Pick<SiteConfig, "name" | "nameEn" | "tagline" | "contact" | "social" | "footer" | "logoUrl" | "payments">

export function toPublicSiteConfig(c: SiteConfig): PublicSiteConfig {
  return { name: c.name, nameEn: c.nameEn, tagline: c.tagline, contact: c.contact, social: c.social, footer: c.footer, logoUrl: c.logoUrl, payments: c.payments }
}

/** Read live on each request, so a disabled feature is enforced across server instances. */
export async function isImageSearchEnabled(): Promise<boolean> {
  if (!isDbConfigured()) return true
  try {
    const [row] = await db.select({ enabled: siteSettings.imageSearchEnabled }).from(siteSettings).limit(1)
    return row?.enabled ?? true
  } catch (error) {
    // Keep ordinary browsing available and fail closed for image search.
    console.error("image search setting unavailable:", error instanceof Error ? error.message : "unknown")
    return false
  }
}
