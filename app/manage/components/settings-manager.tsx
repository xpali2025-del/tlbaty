"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { AdminSettings } from "@/lib/admin"
import { SITE_CONFIG } from "@/lib/site"
import { SUPPORTED_COUNTRIES } from "@/lib/phone"
import { fetchWhatsappStatus, saveSettings } from "../actions"
import type { WhatsappStatus } from "@/lib/whatsapp-status"
import { ImageField, SectionHeader } from "./shared"
import { uploadFormImages } from "@/lib/storage/upload-client"
import { OTP_CHANNELS } from "@/lib/otp/channel"

export function SettingsManager({ settings }: { settings: AdminSettings }) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await uploadFormImages(form, [
          { name: "logo", folder: "site", keyName: "logoKey" },
        ])
        await saveSettings(settings?._id ?? null, form)
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
        description="بيانات المتجر العامة ووسائل التواصل — تُحفظ مباشرة."
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">بيانات عامة</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ImageField name="logo" current={settings?.logo} label="شعار المتجر" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="اسم المتجر">
                <Input name="name" defaultValue={settings?.name ?? ""} placeholder={SITE_CONFIG.name} />
              </Field>
              <Field label="اسم المتجر بالإنجليزية">
                <Input name="nameEn" defaultValue={settings?.nameEn ?? ""} placeholder={SITE_CONFIG.nameEn} dir="ltr" />
              </Field>
              <Field label="الشعار النصي (Slogan)">
                <Input name="tagline" defaultValue={settings?.tagline ?? ""} placeholder={SITE_CONFIG.tagline} />
              </Field>
            </div>
            <Field label="وصف المتجر">
              <Textarea name="description" defaultValue={settings?.description ?? ""} rows={3} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">بيانات التواصل</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
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
            <Field label="ساعات العمل">
              <Input name="workingHours" defaultValue={settings?.workingHours ?? ""} />
            </Field>
            <Field label="العنوان">
              <Input name="address" defaultValue={settings?.address ?? ""} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">روابط التواصل الاجتماعي</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
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
            <p className="text-xs text-muted-foreground sm:col-span-3">
              أدخل رابطاً كاملاً (https://…) أو اسم الحساب فقط. الحقل الفارغ لا يظهر في الموقع.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">طرق الدفع المتاحة للعملاء</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="codEnabled" value="true" defaultChecked={settings?.payments?.cashOnDelivery ?? true} />
              الدفع عند الاستلام
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="transferEnabled" value="true" defaultChecked={settings?.payments?.manualTransfer ?? true} />
              الحوالة / التحويل البنكي (حسابات الدفع تُدار من شاشة «حسابات الدفع»)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="walletEnabled" value="true" defaultChecked={settings?.payments?.wallet ?? true} />
              الرصيد (شحن المحفظة والدفع منها؛ تُدار من شاشة «المحافظ والرصيد»)
            </label>
            <p className="text-xs text-muted-foreground">
              تُفرض طرق الدفع على الخادم أيضاً: الطريقة المعطّلة تُرفض حتى لو أُرسلت من متصفح معدَّل. يجب تفعيل طريقة واحدة على الأقل.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">دول تسجيل دخول العملاء</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <input type="hidden" name="loginCountriesPresent" value="1" />
            {SUPPORTED_COUNTRIES.map((c) => (
              <label key={c.code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="loginCountries"
                  value={c.code}
                  defaultChecked={(settings?.loginCountries ?? ["967"]).includes(c.code)}
                  className="h-4 w-4"
                />
                <span>
                  {c.flag} {c.name} <span dir="ltr">+{c.code}</span>
                </span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              الافتراضي اليمن فقط. عند تفعيل أكثر من دولة تظهر للعميل قائمة لاختيار كود الدولة (مفيدة لاختبار رقم من دولة أخرى). يُفرض هذا على الخادم أيضاً.
              تعطيل دولة يمنع دخول عملائها الحاليين ما دامت معطّلة. رقم بوت واتساب يجب أن يستقبل رسائل من الدولة المفعّلة.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">قناة إرسال رمز التحقق</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {OTP_CHANNELS.map((c) => (
              <label key={c.key} className="flex items-start gap-2 text-sm">
                <input type="radio" name="otpChannel" value={c.key} defaultChecked={(settings?.otpChannel ?? "whatsapp") === c.key} className="mt-1 h-4 w-4" />
                <span>
                  <span className="font-medium">{c.label}</span>
                  <span className="block text-xs text-muted-foreground">{c.hint}</span>
                </span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              تُستخدم هذه القناة لرمز الدخول وتغيير رقم الهاتف، وتسري فوراً بعد الحفظ.
              {settings?.smsConfigured
                ? " مفاتيح SMS Gateway مضبوطة على الخادم."
                : " مفاتيح SMS Gateway غير مضبوطة بعد: أضف SMS_GATE_USERNAME و SMS_GATE_PASSWORD في إعدادات الاستضافة قبل اختيار SMS."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">بوت واتساب لتسجيل دخول العملاء</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="رقم البوت (أرقام دولية بلا + مثل 967777000000)">
              <Input name="loginBotNumber" defaultValue={settings?.loginBotNumber ?? ""} dir="ltr" inputMode="numeric" placeholder="اتركه فارغاً لاستعمال WHATSAPP_BOT_NUMBER" />
            </Field>
            <p className="text-xs text-muted-foreground">
              هذا الرقم الذي يراسله العميل للدخول. عند حظر الرقم: اربط رقماً جديداً في خدمة البوت (امسح QR)، ثم اكتبه هنا واحفظ، فيسري فوراً دون إعادة نشر.
              تغيير الرقم هنا لا يغيّر الرقم المربوط فعلياً في خدمة البوت.
            </p>
            <WhatsappStatusPanel />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">صور إثبات الدفع</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="proofRetentionEnabled" value="true" defaultChecked={settings?.proofRetentionDays != null} />
              حذف صور الإثبات تلقائياً بعد انتهاء الطلب
            </label>
            <label className="flex items-center gap-2 text-sm">
              بعد
              <input
                type="number"
                name="proofRetentionDays"
                min={7}
                max={365}
                defaultValue={settings?.proofRetentionDays ?? 30}
                className="h-9 w-24 rounded-md border bg-background px-2 text-center"
                dir="ltr"
                aria-label="عدد أيام الاحتفاظ"
              />
              يوماً (من 7 إلى 365) من تسليم الطلب أو إلغائه أو إرجاعه
            </label>
            <p className="text-xs text-muted-foreground">
              الحذف نهائي ولا يمكن استرجاع الصورة. لا يشمل الطلبات التي ما زال دفعها بانتظار التحقق، وتبقى بيانات الحوالة النصية
              (اسم المرسل ورقمه ورقم الحوالة) في الطلب. يعمل الحذف يومياً وبدفعات؛ وعند تقصير المدة تُحذف الصور القديمة المستحقة
              في أول تشغيل بعد الحفظ. المخزَّن حالياً: {settings?.storedProofs ?? 0} صورة.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">الفوتر</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="نص الحقوق">
              <Input name="copyright" defaultValue={settings?.copyright ?? ""} />
            </Field>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? "جارٍ الحفظ..." : "حفظ التغييرات"}
          </Button>
        </div>
      </form>
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
