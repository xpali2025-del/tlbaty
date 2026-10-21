import { safeJsonLd } from "@/lib/json-ld"
import type { Metadata } from "next"
import { getSiteConfig, type SiteConfig } from "@/lib/site-config"

// ============================================
// ميتاتاجز صفحة التواصل — صفحة التواصل مكتوبة بـ "use client"
// لذلك لا يمكنها تصدير metadata، فنضعها هنا في layout أبوي.
// هذه أهم صفحة للسيو المحلي (Local SEO).
// ============================================
const title = "تواصل معنا"
const buildDescription = (SITE_CONFIG: SiteConfig) => `تواصل مع متجر تاج لاين في ${SITE_CONFIG.geo.city} - ${SITE_CONFIG.geo.country}. اتصل بنا على ${SITE_CONFIG.contact.phoneDisplay} أو راسلنا عبر واتساب. العنوان: ${SITE_CONFIG.contact.addressFull}. توصيل لجميع محافظات اليمن.`

export async function generateMetadata(): Promise<Metadata> {
  const SITE_CONFIG = await getSiteConfig()
  const description = buildDescription(SITE_CONFIG)
  const url = `${SITE_CONFIG.url}/contact`
  return {
  title,
  description,
  keywords: [
    "تواصل مع متجر تاج لاين",
    "رقم متجر تاج لاين",
    "عنوان متجر تاج لاين صنعاء",
    "متجر ملابس صنعاء",
    "توصيل ملابس اليمن",
  ],
  alternates: { canonical: url },
  openGraph: {
    type: "website",
    title,
    description,
    url,
  },
}
}

// مخطط LocalBusiness كامل لصفحة التواصل — يقوّي ظهور المتجر
// في خرائط جوجل والبحث المحلي داخل اليمن
function buildContactJsonLd(SITE_CONFIG: SiteConfig, url: string, description: string) {
  return {
  "@context": "https://schema.org",
  "@type": "ClothingStore",
  name: SITE_CONFIG.name,
  alternateName: SITE_CONFIG.nameEn,
  description: SITE_CONFIG.description,
  url,
  telephone: SITE_CONFIG.contact.phone,
  image: `${SITE_CONFIG.url}/og-image.png`,
  logo: `${SITE_CONFIG.url}/logo.png`,
  priceRange: SITE_CONFIG.priceRange,
  address: {
    "@type": "PostalAddress",
    streetAddress: SITE_CONFIG.contact.address,
    addressLocality: SITE_CONFIG.geo.city,
    addressRegion: SITE_CONFIG.geo.region,
    addressCountry: SITE_CONFIG.geo.countryCode,
  },
  geo: {
    "@type": "GeoCoordinates",
    latitude: SITE_CONFIG.geo.latitude,
    longitude: SITE_CONFIG.geo.longitude,
  },
  hasMap: `https://www.google.com/maps/search/?api=1&query=${SITE_CONFIG.geo.latitude},${SITE_CONFIG.geo.longitude}`,
  areaServed: SITE_CONFIG.areaServed.map((name) => ({ "@type": "AdministrativeArea", name })),
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: SITE_CONFIG.openingHours.days,
      opens: SITE_CONFIG.openingHours.opens,
      closes: SITE_CONFIG.openingHours.closes,
    },
  ],
  sameAs: Object.values(SITE_CONFIG.social).filter(Boolean),
  }
}

export default async function ContactLayout({ children }: { children: React.ReactNode }) {
  const SITE_CONFIG = await getSiteConfig()
  const url = `${SITE_CONFIG.url}/contact`
  const contactJsonLd = buildContactJsonLd(SITE_CONFIG, url, buildDescription(SITE_CONFIG))
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(contactJsonLd) }}
      />
      {children}
    </>
  )
}
