"use client"

import { useEffect, useRef, useState, useTransition, type ComponentType, type ReactNode } from "react"
import { CreditCard, FileText, Phone, ShieldCheck, Store } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { AdminSettings } from "@/lib/admin"
import { SITE_CONFIG } from "@/lib/site"
import { SUPPORTED_COUNTRIES } from "@/lib/phone"
import { fetchWhatsappStatus, saveSettings } from "../client-actions"
import type { WhatsappStatus } from "@/lib/whatsapp-status"
import { ImageField, SectionHeader } from "./shared"
import { uploadFormImages } from "@/lib/storage/upload-client"
import { OTP_CHANNELS } from "@/lib/otp/channel"

// صفحة إعدادات (Pattern 5): نموذج واحد وحفظ واحد، وأقسام مرتبة بحسب مهمة المدير،
// مع قائمة أقسام لاصقة على الشاشات العريضة وقائمة منسدلة على الجوال. كل الأقسام تبقى في الصفحة
// (لا تبويبات تخفي الحقول) كي تُرسَل كلها مع النموذج كما كانت.

const SECTIONS = [
  { id: "identity", label: "هوية المتجر", icon: Store },
  { id: "contact", label: "التواصل", icon: Phone },
  { id: "sales", label: "الدفع والطلبات", icon: CreditCard },
  { id: "login", label: "تسجيل دخول العملاء", icon: ShieldCheck },
  { id: "footer", label: "الفوتر", icon: FileText },
] as const

type SectionId = (typeof SECTIONS)[number]["id"]

const anchor = (id: SectionId) => `settings-${id}`

export function SettingsManager({ settings }: { settings: AdminSettings }) {
  const [isPending, startTransition] = useTransition()
  const [dirty, setDirty] = useState(false)
  const [active, setActive] = useState<SectionId>("identity")
  // نتجاهل رصد التمرير لحظة القفز اليدوي كي لا يومض التحديد بين الأقسام.
  const jumping = useRef(false)

  useEffect(() => {
    const els = SECTIONS.map((x) => document.getElementById(anchor(x.id))).filter((el): el is HTMLElement => Boolean(el))
    if (typeof IntersectionObserver === "undefined" || els.length === 0) return
    const io = new IntersectionObserver(
      (entries) => {
        if (jumping.current) return
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id.replace("settings-", "") as SectionId)
      },
      { rootMargin: "-15% 0px -70% 0px" },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  function go(id: SectionId) {
    const el = document.getElementById(anchor(id))
    if (!el) return
    setActive(id)
    jumping.current = true
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
    window.setTimeout(() => (jumping.current = false), 700)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isPending) return
    const form = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await uploadFormImages(form, [
          { name: "logo", folder: "site", keyName: "logoKey" },
        ])
        await saveSettings(settings?._id ?? null, form)
        setDirty(false)
        toast.success("تم حفظ إعدادات الموقع")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "تعذّر الحفظ")
      }
    })
  }

  return (
    <div>
      <SectionHeader
        title="إعدادات الموقع"
        description="هوية المتجر وطرق التواصل والدفع وتسجيل الدخول — احفظ مرة واحدة لتطبيق كل التغييرات."
      />

      {/* جوال: قائمة منسدلة لاصقة بدل شريط جانبي */}
      <div className="sticky top-0 z-20 -mx-1 mb-4 bg-background/95 px-1 py-2 backdrop-blur lg:hidden">
        <label htmlFor="settings-jump" className="sr-only">
          الانتقال إلى قسم
        </label>
        <select
          id="settings-jump"
          value={active}
          onChange={(e) => go(e.target.value as SectionId)}
          className="h-11 w-full rounded-lg border bg-card px-3 text-sm font-medium"
        >
          {SECTIONS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </div>

      <form onSubmit={handleSubmit} onChange={() => setDirty(true)} className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <nav aria-label="أقسام الإعدادات" className="sticky top-4 hidden lg:block">
          <ul className="flex flex-col gap-1">
            {SECTIONS.map((x) => {
              const Icon = x.icon
              const on = active === x.id
              return (
                <li key={x.id}>
                  <a
                    href={`#${anchor(x.id)}`}
                    aria-current={on ? "true" : undefined}
                    onClick={(e) => {
                      e.preventDefault()
                      go(x.id)
                    }}
                    className={`flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${
                      on ? "bg-primary/10 font-bold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {x.label}
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="flex min-w-0 max-w-3xl flex-col gap-6">
          <Section id="identity" title="هوية المتجر" description="الاسم والشعار والوصف كما يراها العملاء." icon={Store}>
            <Row label="شعار المتجر">
              <ImageField name="logo" current={settings?.logo} label="رفع الشعار" />
            </Row>
            <Row label="اسم المتجر">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input name="name" aria-label="اسم المتجر بالعربية" defaultValue={settings?.name ?? ""} placeholder={SITE_CONFIG.name} />
                <Input name="nameEn" aria-label="اسم المتجر بالإنجليزية" defaultValue={settings?.nameEn ?? ""} placeholder={SITE_CONFIG.nameEn} dir="ltr" />
              </div>
            </Row>
            <Row label="الشعار النصي">
              <Input name="tagline" aria-label="الشعار النصي" defaultValue={settings?.tagline ?? ""} placeholder={SITE_CONFIG.tagline} />
            </Row>
            <Row label="وصف المتجر">
              <Textarea name="description" aria-label="وصف المتجر" defaultValue={settings?.description ?? ""} rows={3} />
            </Row>
          </Section>

          <Section id="contact" title="التواصل" description="أرقام وعنوان ووسائل التواصل الاجتماعي. الحقل الفارغ لا يظهر في الموقع." icon={Phone}>
            <Row label="الهاتف">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="رقم الهاتف الرئيسي">
                  <Input name="phone" defaultValue={settings?.phone ?? ""} placeholder={SITE_CONFIG.contact.phone} dir="ltr" />
                </Field>
                <Field label="رقم هاتف ثانٍ (اختياري)">
                  <Input name="secondaryPhone" defaultValue={settings?.secondaryPhone ?? ""} dir="ltr" />
                </Field>
                <Field label="رقم واتساب (بالصيغة الدولية)">
                  <Input name="whatsapp" defaultValue={settings?.whatsapp ?? ""} placeholder={SITE_CONFIG.contact.whatsapp} dir="ltr" />
                </Field>
                <Field label="البريد الإلكتروني">
                  <Input name="email" type="email" defaultValue={settings?.email ?? ""} dir="ltr" />
                </Field>
              </div>
            </Row>
            <Row label="العنوان والدوام">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="العنوان">
                  <Input name="address" defaultValue={settings?.address ?? ""} />
                </Field>
                <Field label="ساعات العمل">
                  <Input name="workingHours" defaultValue={settings?.workingHours ?? ""} />
                </Field>
              </div>
            </Row>
            <Row label="وسائل التواصل الاجتماعي" help="رابط كامل (https://…) أو اسم الحساب فقط.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="إنستغرام">
                  <Input name="instagram" defaultValue={settings?.social?.instagram ?? ""} dir="ltr" />
                </Field>
                <Field label="فيسبوك">
                  <Input name="facebook" defaultValue={settings?.social?.facebook ?? ""} dir="ltr" />
                </Field>
                <Field label="تيك توك">
                  <Input name="tiktok" defaultValue={settings?.social?.tiktok ?? ""} dir="ltr" />
                </Field>
                <Field label="إكس (تويتر)">
                  <Input name="x" defaultValue={settings?.social?.x ?? ""} dir="ltr" />
                </Field>
                <Field label="يوتيوب">
                  <Input name="youtube" defaultValue={settings?.social?.youtube ?? ""} dir="ltr" />
                </Field>
                <Field label="سناب شات">
                  <Input name="snapchat" defaultValue={settings?.social?.snapchat ?? ""} dir="ltr" />
                </Field>
                <Field label="تيليجرام">
                  <Input name="telegram" defaultValue={settings?.social?.telegram ?? ""} dir="ltr" />
                </Field>
              </div>
            </Row>
          </Section>

          <Section id="sales" title="الدفع والطلبات" description="ما يستطيع العميل استعماله عند إتمام الطلب، ومدة بقاء صور الإثبات." icon={CreditCard}>
            <Row
              label="طرق الدفع"
              help="تُفرض على الخادم أيضاً: الطريقة المعطّلة تُرفض حتى لو أُرسلت من متصفح معدَّل. يجب تفعيل طريقة واحدة على الأقل."
            >
              <div className="flex flex-col divide-y rounded-lg border">
                <ToggleLine id="codEnabled" name="codEnabled" label="الدفع عند الاستلام" defaultChecked={settings?.payments?.cashOnDelivery ?? true} />
                <ToggleLine
                  id="transferEnabled"
                  name="transferEnabled"
                  label="الحوالة / التحويل البنكي"
                  hint="حسابات الدفع تُدار من شاشة «حسابات الدفع»."
                  defaultChecked={settings?.payments?.manualTransfer ?? true}
                />
                <ToggleLine
                  id="walletEnabled"
                  name="walletEnabled"
                  label="الرصيد"
                  hint="شحن المحفظة والدفع منها؛ تُدار من شاشة «المحافظ والرصيد»."
                  defaultChecked={settings?.payments?.wallet ?? true}
                />
              </div>
            </Row>
            <Row
              label="صور إثبات الدفع"
              help={`الحذف نهائي ولا يمكن استرجاع الصورة. لا يشمل الطلبات التي ما زال دفعها بانتظار التحقق، وتبقى بيانات الحوالة النصية في الطلب. يعمل الحذف يومياً وبدفعات. المخزَّن حالياً: ${settings?.storedProofs ?? 0} صورة.`}
            >
              <div className="flex flex-col gap-3 rounded-lg border p-3">
                <ToggleLine
                  bare
                  id="proofRetentionEnabled"
                  name="proofRetentionEnabled"
                  label="حذف الصور تلقائياً بعد انتهاء الطلب"
                  defaultChecked={settings?.proofRetentionDays != null}
                />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>بعد</span>
                  <input
                    type="number"
                    name="proofRetentionDays"
                    min={7}
                    max={365}
                    defaultValue={settings?.proofRetentionDays ?? 30}
                    className="h-11 w-24 rounded-md border bg-background px-2 text-center"
                    dir="ltr"
                    aria-label="عدد أيام الاحتفاظ"
                  />
                  <span>يوماً (من 7 إلى 365) من تسليم الطلب أو إلغائه أو إرجاعه</span>
                </div>
              </div>
            </Row>
          </Section>

          <Section id="login" title="تسجيل دخول العملاء" description="من يستطيع الدخول، وكيف يصله رمز التحقق." icon={ShieldCheck}>
            <Row
              label="الدول المسموحة"
              help="الافتراضي اليمن فقط. عند تفعيل أكثر من دولة تظهر للعميل قائمة لاختيار كود الدولة. يُفرض على الخادم أيضاً، وتعطيل دولة يمنع دخول عملائها الحاليين. رقم بوت واتساب يجب أن يستقبل رسائل من الدولة المفعّلة."
            >
              <input type="hidden" name="loginCountriesPresent" value="1" />
              <div className="flex flex-wrap gap-2">
                {SUPPORTED_COUNTRIES.map((c) => (
                  <label
                    key={c.code}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:checked]:font-bold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary"
                  >
                    <input
                      type="checkbox"
                      name="loginCountries"
                      value={c.code}
                      defaultChecked={(settings?.loginCountries ?? ["967"]).includes(c.code)}
                      className="sr-only"
                    />
                    <span aria-hidden="true">{c.flag}</span>
                    <span>{c.name}</span>
                    <span dir="ltr" className="text-xs text-muted-foreground">
                      +{c.code}
                    </span>
                  </label>
                ))}
              </div>
            </Row>
            <Row
              label="قناة إرسال رمز التحقق"
              help={`تُستخدم لرمز الدخول وتغيير رقم الهاتف، وتسري فوراً بعد الحفظ. ${
                settings?.smsConfigured
                  ? "مفاتيح SMS Gateway مضبوطة على الخادم."
                  : "مفاتيح SMS Gateway غير مضبوطة بعد: أضف SMS_GATE_USERNAME و SMS_GATE_PASSWORD في إعدادات الاستضافة قبل اختيار SMS."
              }`}
            >
              <div className="grid gap-2" role="radiogroup" aria-label="قناة إرسال رمز التحقق">
                {OTP_CHANNELS.map((c) => (
                  <label
                    key={c.key}
                    className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary"
                  >
                    <input
                      type="radio"
                      name="otpChannel"
                      value={c.key}
                      defaultChecked={(settings?.otpChannel ?? "whatsapp") === c.key}
                      className="mt-1 h-4 w-4 accent-primary"
                    />
                    <span>
                      <span className="block text-sm font-medium">{c.label}</span>
                      <span className="block text-xs text-muted-foreground">{c.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Row>
            <Row
              label="بوت واتساب للدخول"
              help="هذا الرقم الذي يراسله العميل للدخول. عند حظر الرقم: اربط رقماً جديداً في خدمة البوت (امسح QR)، ثم اكتبه هنا واحفظ، فيسري فوراً دون إعادة نشر. تغيير الرقم هنا لا يغيّر الرقم المربوط فعلياً في خدمة البوت."
            >
              <div className="flex flex-col gap-4">
                <Input
                  name="loginBotNumber"
                  aria-label="رقم البوت (أرقام دولية بلا +، مثل 967777000000)"
                  defaultValue={settings?.loginBotNumber ?? ""}
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="اتركه فارغاً لاستعمال WHATSAPP_BOT_NUMBER"
                />
                <WhatsappStatusPanel />
              </div>
            </Row>
          </Section>

          <Section id="footer" title="الفوتر" description="النص الذي يظهر أسفل كل صفحة." icon={FileText}>
            <Row label="نص الحقوق">
              <Input name="copyright" aria-label="نص الحقوق" defaultValue={settings?.copyright ?? ""} />
            </Row>
          </Section>

          {/* شريط الحفظ: الزر قابل للضغط دائماً، وتظهر حالة التغييرات بجانبه */}
          <div className="sticky bottom-3 z-20 flex items-center justify-between gap-3 rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {dirty ? "لديك تغييرات غير محفوظة" : "لا توجد تغييرات"}
            </p>
            <Button type="submit" className="min-h-11 min-w-36" aria-busy={isPending}>
              {isPending ? "جارٍ الحفظ…" : "حفظ التغييرات"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}

function Section({
  id,
  title,
  description,
  icon: Icon,
  children,
}: {
  id: SectionId
  title: string
  description: string
  icon: ComponentType<{ className?: string }>
  children: ReactNode
}) {
  return (
    <section id={anchor(id)} aria-labelledby={`${anchor(id)}-title`} className="scroll-mt-16 rounded-xl border bg-card">
      <header className="flex items-start gap-3 border-b p-4 sm:p-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 id={`${anchor(id)}-title`} className="text-base font-bold">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">{description}</p>
        </div>
      </header>
      <div className="divide-y">{children}</div>
    </section>
  )
}

/** صف إعداد: الاسم والشرح في جانب والتحكم في الجانب الآخر (يتكدّس على الجوال). */
function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 p-4 sm:p-5 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-6">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {help ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground text-pretty">{help}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** مفتاح تشغيل/إيقاف يُرسَل مع النموذج (القيمة true عند التفعيل، وغيابه عند الإيقاف). */
function ToggleLine({
  id,
  name,
  label,
  hint,
  defaultChecked,
  bare,
}: {
  id: string
  name: string
  label: string
  hint?: string
  defaultChecked: boolean
  bare?: boolean
}) {
  return (
    <div className={`flex min-h-11 items-center justify-between gap-4 ${bare ? "" : "px-3 py-2.5"}`}>
      <Label htmlFor={id} className="flex-1 cursor-pointer flex-col items-start gap-0.5 text-sm font-normal leading-snug">
        <span>{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </Label>
      <Switch id={id} name={name} value="true" defaultChecked={defaultChecked} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}


const WORKER_LABELS: Record<WhatsappStatus["worker"], { text: string; cls: string; hint: string }> = {
  ready: { text: "متصل ويعمل", cls: "bg-emerald-500/15 text-emerald-700", hint: "" },
  not_ready: {
    text: "الخدمة تعمل لكن واتساب غير مربوط",
    cls: "bg-amber-500/15 text-amber-700",
    hint: "انتهت الجلسة أو أُلغي الربط أو حُظر الرقم. أعد ربط الرقم (امسح QR من جديد) أو بدّل الرقم.",
  },
  unreachable: {
    text: "لا يمكن الوصول إلى خدمة البوت",
    cls: "bg-destructive/15 text-destructive",
    hint: "الخدمة متوقفة أو الرابط WHATSAPP_WORKER_URL خاطئ. تأكد أنها تعمل على خادمها.",
  },
  unconfigured: {
    text: "خدمة البوت غير مضبوطة",
    cls: "bg-muted text-muted-foreground",
    hint: "اضبط WHATSAPP_WORKER_URL و WHATSAPP_WORKER_TOKEN في بيئة الموقع.",
  },
}

/** حالة البوت الحيّة: متصل؟ آخر دخول ناجح؟ تكشف الحظر قبل أن يشتكي العملاء. */
function WhatsappStatusPanel() {
  const [status, setStatus] = useState<WhatsappStatus | null>(null)
  const [error, setError] = useState(false)
  const [pending, startTransition] = useTransition()

  const check = () =>
    startTransition(async () => {
      try {
        setStatus(await fetchWhatsappStatus())
        setError(false)
      } catch {
        setError(true)
      }
    })

  useEffect(() => {
    check()
  }, [])

  const label = status ? WORKER_LABELS[status.worker] : null
  const fmt = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" }).format(new Date(iso)) : "لم يحدث بعد"
  return (
    <div className="rounded-lg border p-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">حالة البوت</span>
        <Button type="button" size="sm" variant="outline" onClick={check} disabled={pending}>
          {pending ? "جارٍ الفحص…" : "فحص الآن"}
        </Button>
      </div>
      {error && <p className="mt-2 text-destructive">تعذّر فحص الحالة.</p>}
      {status && label && (
        <dl className="mt-3 grid gap-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">الاتصال</dt>
            <dd><span className={`rounded-full px-2 py-0.5 font-bold ${label.cls}`}>{label.text}</span></dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">رقم البوت المعتمد</dt>
            <dd dir="ltr" className="font-mono">
              {status.botNumber ?? "غير مضبوط"}
              {status.botNumber ? ` (${status.botNumberSource === "settings" ? "من الإعدادات" : "من المتغير"})` : ""}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">آخر دخول ناجح عبر البوت</dt>
            <dd>{fmt(status.lastLoginAt)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">عمليات دخول آخر 24 ساعة</dt>
            <dd>{status.logins24h}</dd>
          </div>
          {label.hint && <p className="mt-1 text-muted-foreground">{label.hint}</p>}
          {!status.botNumber && <p className="mt-1 text-destructive">لا يوجد رقم بوت: زر الدخول بواتساب لن يعمل. اكتب الرقم أعلاه.</p>}
        </dl>
      )}
    </div>
  )
}
