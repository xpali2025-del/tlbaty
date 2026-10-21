import { safeJsonLd } from "@/lib/json-ld"
import type { Metadata } from "next"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { MessageCircle, Headphones } from "lucide-react"
import { getSiteConfig } from "@/lib/site-config"

export const metadata: Metadata = {
  title: "الأسئلة الشائعة",
  description: "إجابات على أكثر الأسئلة شيوعاً حول الطلب والشحن والإرجاع وطرق الدفع في متجر تاج لاين.",
}

// ============================================
// الأسئلة الشائعة - ثابتة في HTML للأرشفة و SEO
// ============================================
const FAQS = [
  {
    q: "كيف يمكنني تتبع طلبي؟",
    a: "سجّل الدخول إلى حسابك ثم افتح شاشة «طلباتي»، وستظهر جميع طلباتك وحالتها تلقائياً دون إدخال أي رقم. اضغط أي طلب لعرض تفاصيله الكاملة.",
  },
  {
    q: "ما هي مدة التوصيل؟",
    a: "نوفر خيارين للشحن: الشحن السريع خلال 1-2 يوم عمل، والشحن العادي خلال 3-5 أيام عمل. كما يمكنك استلام طلبك من المتجر مجاناً.",
  },
  {
    q: "هل المنتجات أصلية؟",
    a: "نعم، جميع منتجاتنا أصلية 100% ومضمونة الجودة. نختار موردين موثوقين ونفحص كل منتج قبل شحنه.",
  },
  {
    q: "هل يمكنني إرجاع المنتج؟",
    a: "نعم، يمكنك إرجاع المنتج خلال يوم واحد فقط من تاريخ الاستلام بشرط أن يكون بحالته الأصلية ومع التغليف. راجع سياسة الاسترجاع للتفاصيل.",
  },
  {
    q: "ما هي طرق الدفع المتاحة؟",
    a: "نوفر عدة طرق آمنة للدفع: الدفع عند الاستلام، البطاقات الائتمانية، التحويل البنكي، والمحافظ الإلكترونية.",
  },
  {
    q: "كيف أستخدم كود الخصم؟",
    a: "أدخل كود الخصم في حقل 'كود الخصم' في صفحة إتمام الطلب، ثم اضغط 'تطبيق الكود' وسيتم خصم القيمة من إجمالي الطلب تلقائياً.",
  },
  {
    q: "هل أحتاج لإنشاء حساب للشراء؟",
    a: "لا، يمكنك إتمام طلبك مباشرة عبر واتساب دون الحاجة لإنشاء حساب. فقط أدخل بياناتك في صفحة إتمام الطلب.",
  },
]

// JSON-LD للأسئلة الشائعة - يساعد في Rich Snippets في جوجل
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
}

export default async function FAQPage() {
  const SITE_CONFIG = await getSiteConfig()
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd) }}
      />
      <Header />
      <main className="pb-24 lg:pb-12 mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl md:text-3xl font-bold mb-2 text-center">الأسئلة الشائعة</h1>
        <p className="text-muted-foreground text-sm text-center mb-8">
          إجابات على أكثر الأسئلة شيوعاً
        </p>

        <Accordion type="single" collapsible className="space-y-3">
          {FAQS.map((faq, i) => (
            <AccordionItem
              key={i}
              value={`item-${i}`}
              className="bg-card border border-border rounded-2xl px-5 data-[state=open]:border-primary/40"
            >
              <AccordionTrigger className="text-right font-bold hover:no-underline py-4">
                {faq.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed pb-4">
                {faq.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {/* بطاقة المساعدة */}
        <div className="bg-secondary rounded-2xl p-6 mt-8 text-center">
          <Headphones className="w-12 h-12 mx-auto text-primary mb-3" />
          <h2 className="font-bold text-lg mb-1">لم تجد إجابتك؟</h2>
          <p className="text-sm text-muted-foreground mb-4">
            تواصل معنا الآن نحن هنا لمساعدتك
          </p>
          <a
            href={SITE_CONFIG.social.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-6 py-3 font-bold hover:bg-primary/90 transition-colors"
          >
            <MessageCircle className="w-5 h-5" />
            تواصل عبر واتساب
          </a>
        </div>
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
