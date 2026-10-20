import Link from "next/link"
import { MapPin, Phone, Instagram, Facebook } from "lucide-react"
import { SITE_CONFIG, FOOTER_LINKS } from "@/lib/site"

type FooterLink = { label: string; href: string }

// ============================================
// مكوّن عرض الفوتر (بدون جلب بيانات)
// يستقبل الأقسام كـ prop ليعمل في سياق Server و Client معاً
// ============================================
export function FooterView({ categories }: { categories: FooterLink[] }) {
  return (
    <footer className="bg-footer text-footer-foreground mt-12" itemScope itemType="https://schema.org/Store">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* عمود الشركة - بيانات ثابتة */}
          <div className="lg:order-4">
            <div className="bg-background/10 rounded-2xl p-4 inline-block mb-4">
              <span className="font-display text-3xl font-bold text-footer-foreground">{SITE_CONFIG.name}</span>
              <span className="block text-xs tracking-[0.3em] text-footer-foreground/70 mt-1">
                {SITE_CONFIG.nameEn}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-footer-foreground/80 mb-4">
              <span itemProp="description">
                {SITE_CONFIG.tagline}. نختار لك الأفضل لنقدم لك تجربة تسوق فريدة وآمنة.
              </span>
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                <a
                  href={`tel:${SITE_CONFIG.contact.phone}`}
                  className="hover:text-primary transition-colors"
                  itemProp="telephone"
                  dir="ltr"
                >
                  {SITE_CONFIG.contact.phoneDisplay}
                </a>
              </li>
              <li className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                <span itemProp="address">{SITE_CONFIG.contact.address}</span>
              </li>
            </ul>
          </div>

          {/* الأقسام - ديناميكية من Sanity */}
          <div>
            <h3 className="font-bold text-lg mb-4 text-footer-foreground">الأقسام</h3>
            <ul className="space-y-2 text-sm">
              {categories.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-footer-foreground/80 hover:text-primary transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* روابط مهمة */}
          <div>
            <h3 className="font-bold text-lg mb-4 text-footer-foreground">روابط مهمة</h3>
            <ul className="space-y-2 text-sm">
              {FOOTER_LINKS.important.map((link) => (
                <li key={`${link.label}-${link.href}`}>
                  <Link
                    href={link.href}
                    className="text-footer-foreground/80 hover:text-primary transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* النشرة البريدية */}
          <div>
            <h3 className="font-bold text-lg mb-4 text-footer-foreground">اشترك في نشرتنا البريدية</h3>
            <p className="text-sm text-footer-foreground/80 mb-4 leading-relaxed">
              اشترك للحصول على أحدث العروض والمنتجات الجديدة
            </p>
            <form className="space-y-3" action="/api/newsletter" method="post">
              <label htmlFor="newsletter-email" className="sr-only">
                البريد الإلكتروني
              </label>
              <input
                id="newsletter-email"
                type="email"
                name="email"
                required
                placeholder="أدخل بريدك الإلكتروني"
                className="w-full bg-background/10 border border-background/20 rounded-full px-5 py-3 text-sm text-footer-foreground placeholder:text-footer-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="submit"
                className="w-full bg-primary text-primary-foreground font-bold rounded-full py-3 text-sm hover:bg-primary/90 transition-colors"
              >
                اشترك الآن
              </button>
            </form>
            <div className="flex items-center gap-3 mt-5">
              <a
                href={SITE_CONFIG.social.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="تواصل عبر واتساب"
                className="w-9 h-9 rounded-full bg-background/10 flex items-center justify-center hover:bg-primary transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
              </a>
              <a
                href={SITE_CONFIG.social.tiktok}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="تيك توك"
                className="w-9 h-9 rounded-full bg-background/10 flex items-center justify-center hover:bg-primary transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.84a8.16 8.16 0 0 0 4.77 1.52V6.93a4.85 4.85 0 0 1-1.84-.24z" />
                </svg>
              </a>
              <a
                href={SITE_CONFIG.social.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="انستغرام"
                className="w-9 h-9 rounded-full bg-background/10 flex items-center justify-center hover:bg-primary transition-colors"
              >
                <Instagram className="w-4 h-4" />
              </a>
              <a
                href={SITE_CONFIG.social.facebook}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="فيسبوك"
                className="w-9 h-9 rounded-full bg-background/10 flex items-center justify-center hover:bg-primary transition-colors"
              >
                <Facebook className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        {/* الحقوق */}
        <div className="mt-12 pt-6 border-t border-background/10 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-footer-foreground/70">
          <p>{SITE_CONFIG.footer.copyright}</p>
          <p>{SITE_CONFIG.footer.credit}</p>
        </div>
      </div>
    </footer>
  )
}
