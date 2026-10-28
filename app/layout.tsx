import { safeJsonLd } from "@/lib/json-ld"
import type { Metadata, Viewport } from "next"
import { Tajawal } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { CartProvider } from "@/components/cart-provider"
import { WishlistProvider } from "@/components/wishlist-provider"
import { CurrencyProvider } from "@/components/currency-provider"
import { NotificationsProvider } from "@/components/notifications-provider"
import { Toaster } from "@/components/ui/toaster"
import { getCurrencySettings } from "@/lib/data"
import { getSiteConfig, toPublicSiteConfig, type SiteConfig } from "@/lib/site-config"
import { SiteConfigProvider } from "@/components/site-config-provider"
import { CustomerSync } from "@/components/customer-sync"
import "./globals.css"

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  // الأوزان المستعملة فعلاً فقط (لا font-light/extrabold في الواجهة): كل وزن إضافي ملف خط آخر على كل صفحة.
  weight: ["400", "500", "700"],
  variable: "--font-tajawal",
  display: "swap",
})

// ============================================
// SEO ثابت في HTML - يقرأه جوجل أثناء الزحف
// ============================================
export async function generateMetadata(): Promise<Metadata> {
  const SITE_CONFIG = await getSiteConfig()
  return {
  metadataBase: new URL(SITE_CONFIG.url),
  title: {
    default: `${SITE_CONFIG.name} | متجر ملابس وأزياء رجالية ونسائية وأطفال`,
    template: `%s | ${SITE_CONFIG.name}`,
  },
  description: SITE_CONFIG.description,
  keywords: [...SITE_CONFIG.keywords],
  authors: [{ name: SITE_CONFIG.name }],
  creator: SITE_CONFIG.name,
  publisher: SITE_CONFIG.name,
  generator: "Next.js",
  applicationName: SITE_CONFIG.name,
  referrer: "origin-when-cross-origin",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: SITE_CONFIG.locale,
    url: SITE_CONFIG.url,
    title: `${SITE_CONFIG.name} | متجر الأزياء الأول في اليمن`,
    description: SITE_CONFIG.description,
    siteName: SITE_CONFIG.name,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: `${SITE_CONFIG.name} - ${SITE_CONFIG.tagline}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_CONFIG.name,
    description: SITE_CONFIG.description,
    images: ["/og-image.png"],
  },
  alternates: {
    canonical: SITE_CONFIG.url,
  },
  category: "shopping",
  formatDetection: {
    telephone: true,
    email: false,
    address: true,
  },
}
}

export const viewport: Viewport = {
  themeColor: "#DC2626",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
}

// ============================================
// JSON-LD للمتجر (Schema.org) - سيو محلي متقدم
// نوع ClothingStore (وهو LocalBusiness) مع إحداثيات
// جغرافية وساعات عمل ومناطق الخدمة داخل اليمن
// ============================================
function buildLocalBusinessJsonLd(SITE_CONFIG: SiteConfig) {
  return {

  "@context": "https://schema.org",
  "@type": "ClothingStore",
  "@id": SITE_CONFIG.ids.store,
  name: SITE_CONFIG.name,
  alternateName: SITE_CONFIG.nameEn,
  description: SITE_CONFIG.description,
  slogan: SITE_CONFIG.tagline,
  url: SITE_CONFIG.url,
  // ربط الشعار ككيان ImageObject مستقل بمعرّف ثابت
  logo: {
    "@type": "ImageObject",
    "@id": SITE_CONFIG.ids.logo,
    url: SITE_CONFIG.logoUrl ?? `${SITE_CONFIG.url}/logo.png`,
  },
  image: `${SITE_CONFIG.url}/og-image.png`,
  telephone: SITE_CONFIG.contact.phone,
  priceRange: SITE_CONFIG.priceRange,
  currenciesAccepted: "YER",
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
  areaServed: SITE_CONFIG.areaServed.map((name) => ({
    "@type": "AdministrativeArea",
    name,
  })),
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: SITE_CONFIG.openingHours.days,
      opens: SITE_CONFIG.openingHours.opens,
      closes: SITE_CONFIG.openingHours.closes,
    },
  ],
  contactPoint: {
    "@type": "ContactPoint",
    telephone: SITE_CONFIG.contact.phone,
    contactType: "customer service",
    areaServed: SITE_CONFIG.geo.countryCode,
    availableLanguage: ["Arabic"],
  },
  sameAs: Object.values(SITE_CONFIG.social).filter(Boolean),
  }
}

// JSON-LD للموقع مع مربع البحث (يفعّل Sitelinks Search Box في جوجل)
function buildWebSiteJsonLd(SITE_CONFIG: SiteConfig) {
  return {

  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": SITE_CONFIG.ids.website,
  name: SITE_CONFIG.name,
  alternateName: SITE_CONFIG.nameEn,
  url: SITE_CONFIG.url,
  inLanguage: "ar-YE",
  publisher: { "@id": SITE_CONFIG.ids.store },
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_CONFIG.url}/search?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [{ currencies, defaultCode }, siteConfig] = await Promise.all([getCurrencySettings(), getSiteConfig()])
  const localBusinessJsonLd = buildLocalBusinessJsonLd(siteConfig)
  const webSiteJsonLd = buildWebSiteJsonLd(siteConfig)

  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${tajawal.variable} bg-background`}
    >
      <head />
      <body className="font-sans antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(localBusinessJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(webSiteJsonLd) }}
        />
        <SiteConfigProvider config={toPublicSiteConfig(siteConfig)}>
        <CurrencyProvider currencies={currencies} defaultCode={defaultCode}>
          <CartProvider>
            <WishlistProvider>
              <NotificationsProvider>
                {children}
                <CustomerSync />
                <Toaster />
              </NotificationsProvider>
            </WishlistProvider>
          </CartProvider>
        </CurrencyProvider>
        </SiteConfigProvider>
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
