import type { Metadata } from "next"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import { CheckCircle2, XCircle } from "lucide-react"
import { SITE_CONFIG } from "@/lib/site"

export const metadata: Metadata = {
  title: "سياسة الاسترجاع والاستبدال",
  description: `تعرف على شروط وإجراءات استرجاع واستبدال المنتجات في متجر ${SITE_CONFIG.name}.`,
}

// ============================================
// سياسة الاسترجاع - ثابتة في HTML للـ SEO والمتطلبات القانونية
// ============================================
export default function ReturnsPage() {
  return (
    <>
      <Header />
      <main className="pb-24 lg:pb-12 mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">سياسة الاسترجاع والاستبدال</h1>
        <p className="text-sm text-muted-foreground mb-6">آخر تحديث: 1 مايو 2026</p>

        <div className="space-y-5">
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5">
            <h2 className="font-bold text-lg mb-2 text-primary">سياستنا</h2>
            <p className="text-foreground leading-relaxed">
              نضمن لك استرجاع أو استبدال أي منتج خلال <strong>يوم واحد فقط</strong> من تاريخ الاستلام،
              بشرط الالتزام بالشروط الموضحة أدناه.
            </p>
          </div>

          <section className="bg-card border border-border rounded-2xl p-5">
            <h2 className="font-bold text-lg mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              المنتجات القابلة للاسترجاع
            </h2>
            <ul className="space-y-2 text-muted-foreground">
              <li className="flex gap-2">
                <span className="text-emerald-600">•</span>
                المنتجات بحالتها الأصلية وغير المستخدمة
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-600">•</span>
                المنتجات مع التغليف الأصلي والملصقات
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-600">•</span>
                المنتجات التي تحتوي على عيب صناعي
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-600">•</span>
                المنتجات المختلفة عن الوصف أو الصور
              </li>
            </ul>
          </section>

          <section className="bg-card border border-border rounded-2xl p-5">
            <h2 className="font-bold text-lg mb-3 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-destructive" />
              المنتجات غير القابلة للاسترجاع
            </h2>
            <ul className="space-y-2 text-muted-foreground">
              <li className="flex gap-2">
                <span className="text-destructive">•</span>
                المنتجات المستخدمة أو التالفة
              </li>
              <li className="flex gap-2">
                <span className="text-destructive">•</span>
                الملابس الداخلية والمنتجات الشخصية
              </li>
              <li className="flex gap-2">
                <span className="text-destructive">•</span>
                العطور المفتوحة
              </li>
              <li className="flex gap-2">
                <span className="text-destructive">•</span>
                المنتجات المخفضة بنسبة 50% أو أكثر
              </li>
            </ul>
          </section>

          <section className="bg-card border border-border rounded-2xl p-5">
            <h2 className="font-bold text-lg mb-3">خطوات الاسترجاع</h2>
            <ol className="space-y-3">
              {[
                "تواصل معنا عبر واتساب أو البريد الإلكتروني خلال يوم واحد",
                "اشرح سبب الاسترجاع وأرفق صور المنتج إن لزم",
                "سنرسل لك تعليمات الشحن العكسي",

              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="bg-card border border-border rounded-2xl p-5">
            <h2 className="font-bold text-lg mb-2">للاستفسار</h2>
            <p className="text-muted-foreground">
              تواصل مع خدمة العملاء على:
              <br />
              واتساب: <a href={SITE_CONFIG.social.whatsapp} className="text-primary hover:underline" dir="ltr">{SITE_CONFIG.contact.phoneDisplay}</a>
              <br />
              البريد: <a href={`mailto:${SITE_CONFIG.contact.email}`} className="text-primary hover:underline">{SITE_CONFIG.contact.email}</a>
            </p>
          </section>
        </div>
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
