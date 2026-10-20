import type { Metadata } from "next"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import { Award, Heart, Shield, Truck, Users, Sparkles } from "lucide-react"
import { SITE_CONFIG } from "@/lib/site"

export const metadata: Metadata = {
  title: "من نحن",
  description: `تعرف على متجر ${SITE_CONFIG.name} للأزياء والملابس. قصتنا، رؤيتنا، ولماذا نحن الخيار الأول للأزياء في المنطقة.`,
}

// ============================================
// صفحة "من نحن" - ثابتة بالكامل في HTML للـ SEO
// ============================================
export default function AboutPage() {
  return (
    <>
      <Header />
      <main className="pb-24 lg:pb-12 mx-auto max-w-4xl px-4 py-6">
        <header className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">من نحن</h1>
          <p className="text-muted-foreground text-pretty max-w-2xl mx-auto leading-relaxed">
            {SITE_CONFIG.name} هي وجهتك الأولى للأناقة والجودة. نقدم لك تشكيلة واسعة من أرقى الملابس
            والأزياء الرجالية والنسائية والأطفال من أشهر الماركات وبأفضل الأسعار.
          </p>
        </header>

        {/* قصتنا */}
        <section className="bg-card border border-border rounded-2xl p-6 mb-6">
          <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            قصتنا
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            انطلق متجر {SITE_CONFIG.name} برؤية واضحة: تقديم أفضل المنتجات بأفضل الأسعار وأعلى مستوى
            من الخدمة. نؤمن بأن الأناقة حق للجميع، ولذلك حرصنا على توفير تشكيلة متنوعة تناسب جميع
            الأذواق والميزانيات.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            على مدى سنوات من العمل المتواصل، بنينا ثقة آلاف العملاء في جميع أنحاء المنطقة. ولا زلنا
            نعمل بنفس الشغف والإخلاص لنبقى الخيار الأول لكل من يبحث عن الجودة والأناقة معاً.
          </p>
        </section>

        {/* لماذا نحن */}
        <section className="mb-6">
          <h2 className="text-xl font-bold mb-4 text-center">لماذا نحن؟</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Award, title: "جودة عالية", desc: "منتجات أصلية 100% من أفضل الموردين" },
              { icon: Truck, title: "شحن سريع", desc: "نشحن إلى جميع المناطق بأسرع وقت ممكن" },
              { icon: Shield, title: "دفع آمن", desc: "طرق دفع متعددة وآمنة لراحتك" },
              { icon: Heart, title: "خدمة مميزة", desc: "فريق دعم متاح 24/7 لمساعدتك" },
              { icon: Users, title: "آلاف العملاء", desc: "نخدم آلاف العملاء بثقة كاملة" },
              { icon: Sparkles, title: "أحدث الصيحات", desc: "نواكب أحدث صيحات الموضة العالمية" },
            ].map((item) => {
              const Icon = item.icon
              return (
                <div key={item.title} className="bg-card border border-border rounded-2xl p-5 text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold mb-1">{item.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              )
            })}
          </div>
        </section>

        {/* خطوات التنفيذ */}
        <section className="bg-card border border-border rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-4">كيف نعمل؟</h2>
          <ol className="space-y-4">
            {[
              { num: "1", title: "اختر منتجك", desc: "تصفح تشكيلتنا الواسعة واختر ما يعجبك" },
              { num: "2", title: "أضف للسلة", desc: "حدد المقاس واللون والكمية المطلوبة" },
              { num: "3", title: "أتمم الطلب", desc: "أدخل بياناتك وطريقة التوصيل المناسبة" },
              { num: "4", title: "استلم طلبك", desc: "نقوم بشحن طلبك بسرعة وأمان لباب منزلك" },
            ].map((step) => (
              <li key={step.num} className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold shrink-0">
                  {step.num}
                </div>
                <div>
                  <h3 className="font-bold mb-1">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
