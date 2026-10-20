import type { Metadata } from "next"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import { SITE_CONFIG } from "@/lib/site"

export const metadata: Metadata = {
  title: "سياسة الخصوصية",
  description: `سياسة الخصوصية وحماية البيانات في متجر ${SITE_CONFIG.name}.`,
}

// ============================================
// سياسة الخصوصية - ثابتة في HTML للـ SEO والمتطلبات القانونية
// ============================================
export default function PrivacyPage() {
  return (
    <>
      <Header />
      <main className="pb-24 lg:pb-12 mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">سياسة الخصوصية</h1>
        <p className="text-sm text-muted-foreground mb-6">آخر تحديث: 2 أغسطس 2026</p>

        <div className="space-y-5 text-foreground leading-relaxed">
          <section>
            <h2 className="text-lg font-bold mb-2">مقدمة</h2>
            <p className="text-muted-foreground">
              في متجر {SITE_CONFIG.name}، نحن ملتزمون بحماية خصوصية عملائنا. توضح هذه السياسة كيفية
              جمعنا واستخدامنا وحمايتنا للبيانات الشخصية التي تشاركها معنا.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-2">البيانات التي نجمعها</h2>
            <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
              <li>الاسم الكامل ورقم الهاتف</li>
              <li>عنوان التوصيل والبريد الإلكتروني</li>
              <li>بيانات الطلب والمنتجات المشتراة</li>
              <li>طريقة الدفع، وعند التحويل: اسم المرسل ورقم الحوالة وصورة إثبات التحويل</li>
              <li>ملاحظة الطلب الاختيارية التي تكتبها بنفسك (نص فقط)</li>
              <li>معلومات تقنية مثل عنوان IP ونوع المتصفح</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-2">كيف نستخدم بياناتك</h2>
            <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
              <li>تنفيذ الطلبات وتوصيلها إلى عنوانك</li>
              <li>التحقق من الدفع ومطابقة الحوالة بالطلب</li>
              <li>التواصل معك بخصوص طلبك</li>
              <li>تحسين خدماتنا ومنتجاتنا</li>
              <li>إرسال العروض الترويجية (بموافقتك)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-2">العناوين المحفوظة على جهازك</h2>
            <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
              <li>يُحفظ الاسم ورقم الهاتف والعنوان والإحداثيات محلياً على جهازك ومتصفحك لتسهيل طلباتك القادمة.</li>
              <li>يمكنك في أي وقت تعديل عناوينك المحفوظة أو حذفها من صفحة إتمام الطلب.</li>
              <li>حذف العنوان محلياً لا يحذف الطلبات السابقة التي أرسلتها إلينا.</li>
              <li>قد تضيع هذه البيانات المحلية عند مسح بيانات المتصفح أو التطبيق.</li>
              <li>لا نُنشئ حساب عميل ولا نرسل قائمة عناوينك المحفوظة إلى خوادمنا؛ يُرسل فقط العنوان المختار مع الطلب الحالي.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-2">تحديد الموقع (GPS)</h2>
            <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
              <li>تحديد موقع التوصيل بإحداثيات صالحة شرط أساسي لإرسال أي طلب.</li>
              <li>لا يعمل تحديد الموقع (GPS) إلا بعد موافقتك الصريحة على إذن الوصول للموقع.</li>
              <li>يُستخدم الموقع لغرض التوصيل فقط، وقد يُشارك مع مندوب التوصيل لإيصال طلبك.</li>
              <li>لا نجري أي مراقبة مستمرة لموقعك؛ يُلتقط الموقع مرة واحدة عند طلبك فقط.</li>
              <li>يُرسل مع الطلب العنوان المختار وإحداثياته ووقت التقاطها فقط.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-2">الميكروفون والتحويل من الصوت إلى نص</h2>
            <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
              <li>
                استخدام الميكروفون اختياري بالكامل، ويُستخدم فقط لتحويل كلامك إلى نص في حقل ملاحظة
                الطلب.
              </li>
              <li>
                لا نطلب إذن الميكروفون عند فتح الصفحة؛ يُطلب الإذن فقط بعد ضغطك على زر الميكروفون،
                ويتوقف الاستماع تلقائياً بعد انتهاء كلامك أو عند مغادرة الصفحة.
              </li>
              <li>
                يتم التعرف على الكلام عبر خدمة التعرف الصوتي المدمجة في متصفحك، ولا نشغّل الميكروفون
                في الخلفية.
              </li>
              <li>
                نحفظ النص النهائي فقط بعد مراجعتك له. لا نُنشئ أي تسجيل صوتي ولا نحفظه ولا نرفعه إلى
                خوادمنا.
              </li>
              <li>
                رفض إذن الميكروفون أو عدم دعم المتصفح لهذه الميزة لا يمنعك من كتابة الملاحظة يدوياً
                أو إتمام طلبك.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-2">بيانات الدفع</h2>
            <p className="text-muted-foreground mb-2">
              نوفّر طريقتين للدفع: الدفع عند الاستلام، أو التحويل اليدوي إلى أحد حسابات الدفع
              المعروضة في صفحة إتمام الطلب. الحسابات المعروضة تخصّ المتجر ويُستخدمها لاستقبال قيمة
              الطلب فقط.
            </p>
            <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
              <li>نجمع طريقة الدفع التي اخترتها (الدفع عند الاستلام أو تحويل يدوي).</li>
              <li>عند التحويل نجمع اسم مرسل الحوالة ورقم الحوالة وصورة إثبات التحويل.</li>
              <li>
                نحفظ نسخة ثابتة من تفاصيل حساب الدفع المستخدم (اسم المزوّد وصاحب الحساب ورقمه) حتى
                يبقى سجل الطلب صحيحاً لو عُدّل الحساب لاحقاً.
              </li>
              <li>
                تُستخدم هذه البيانات لغرض التحقق من الدفع وتنفيذ الطلب وحل أي خلاف مالي فقط، ولا
                تُستخدم للتسويق.
              </li>
              <li>
                تُحفظ صورة إثبات الحوالة مشفّرة على الخادم، ولا يمكن فتحها من أي رابط عام؛ الوصول
                إليها محصور بالمخوّلين في إدارة المتجر عبر مسار محمي يتطلب تسجيل دخول إداري.
              </li>
              <li>نُزيل البيانات الوصفية (EXIF) من صورة الإثبات قبل حفظها.</li>
              <li>
                لا نطلب ولا نحفظ إطلاقاً: أرقام البطاقات البنكية، أو الأرقام السرية، أو رموز التحقق،
                أو كلمات مرور المحافظ.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-2">مدة الاحتفاظ بالبيانات وحذفها</h2>
            <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
              <li>
                نحتفظ ببيانات الدفع وإثبات الحوالة للمدة اللازمة للتحقق ومعالجة الطلب وتسوية أي
                نزاع، وبما يتوافق مع التزاماتنا المحاسبية والقانونية.
              </li>
              <li>
                لا تُحذف صورة الإثبات تلقائياً عند رفض التحقق؛ تبقى للمراجعة الإدارية وفق سياسة
                الاحتفاظ.
              </li>
              <li>
                يمكنك طلب حذف بيانات الدفع الخاصة بك بالتواصل معنا، وننفّذ الطلب متى ما سمح الالتزام
                المالي والقانوني بذلك بعد انتهاء المدة اللازمة.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-2">حماية البيانات</h2>
            <p className="text-muted-foreground">
              نطبق إجراءات أمنية صارمة لحماية بياناتك من الوصول غير المصرح به. لا نشارك بياناتك مع
              أي طرف ثالث إلا للضرورة (مثل شركات الشحن).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-2">حقوقك</h2>
            <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
              <li>الحق في الوصول إلى بياناتك الشخصية</li>
              <li>الحق في تصحيح البيانات غير الصحيحة</li>
              <li>الحق في طلب حذف بياناتك</li>
              <li>الحق في إلغاء الاشتراك من الرسائل الترويجية</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-2">التواصل معنا</h2>
            <p className="text-muted-foreground">
              لأي استفسار حول سياسة الخصوصية، يمكنك التواصل معنا عبر:
              <br />
              البريد الإلكتروني: <a href={`mailto:${SITE_CONFIG.contact.email}`} className="text-primary hover:underline">{SITE_CONFIG.contact.email}</a>
              <br />
              الهاتف: <span dir="ltr">{SITE_CONFIG.contact.phoneDisplay}</span>
            </p>
          </section>
        </div>
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
