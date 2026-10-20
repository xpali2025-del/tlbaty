import type { Metadata } from "next"
import { SITE_CONFIG } from "@/lib/site"

// ============================================
// ميتاتاجز صفحة التواصل — صفحة التواصل مكتوبة بـ "use client"
// لذلك لا يمكنها تصدير metadata، فنضعها هنا في layout أبوي.
// هذه أهم صفحة للسيو المحلي (Local SEO).
// ============================================
const title = "تواصل معنا"
const description = `تواصل مع متجر تاج لاين في ${SITE_CONFIG.geo.city} - ${SITE_CONFIG.geo.country}. اتصل بنا على ${SITE_CONFIG.contact.phoneDisplay} أو راسلنا عبر واتساب. العنوان: ${SITE_CONFIG.contact.addressFull}. توصيل لجميع محافظات اليمن.`
const url = `${SITE_CONFIG.url}/contact`

export const metadata: Metadata = {
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

// مخطط LocalBusiness كامل لصفحة التواصل — يقوّي ظهور المتجر
// في خرائط جوجل والبحث المحلي داخل اليمن
const contactJsonLd = {
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

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(contactJsonLd) }}
      />
      {children}
    </>
  )
}
