"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Banknote,
  Check,
  Copy,
  ImageIcon,
  Loader2,
  ShieldCheck,
  Trash2,
  Wallet,
  X,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SafeImage } from "@/components/safe-image"
import { useSiteConfig } from "@/components/site-config-provider"
import { useToast } from "@/hooks/use-toast"
import type { PaymentAccount, PaymentMethod } from "@/lib/payment"

// ============================================
// قسم «طريقة الدفع» في صفحة إتمام الطلب
//
// الحالة مرفوعة إلى المكوّن الأب (checkout-client) لأن الإرسال يحتاجها،
// لكن كل منطق العرض والتحقق المبدئي والضغط يبقى هنا.
// صورة الإثبات تبقى في ذاكرة الصفحة فقط ولا تُحفظ في localStorage.
// ============================================

/** الحجم المستهدف بعد الضغط على العميل. */
const TARGET_PROOF_BYTES = Math.floor(2.5 * 1024 * 1024)

/** أقصى حجم مقبول من المستخدم قبل الضغط. */
const MAX_PICK_BYTES = 12 * 1024 * 1024

/** أقصى بعد للصورة بعد الضغط — يحافظ على وضوح أرقام الحوالة. */
const MAX_CLIENT_DIMENSION = 2200

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"]

export type PaymentSelection = {
  method: PaymentMethod
  accountId: string
  senderName: string
  senderPhone: string
  reference: string
  proofFile: File | null
}

export const EMPTY_PAYMENT_SELECTION: PaymentSelection = {
  method: "cash_on_delivery",
  accountId: "",
  senderName: "",
  senderPhone: "",
  reference: "",
  proofFile: null,
}

/** يحوّل الأرقام العربية إلى إنجليزية للتحقق من الطول فقط (القيمة تبقى كما كتبها العميل). */
function digitsOnly(value: string): string {
  return value.replace(/[^\d\u0660-\u0669\u06f0-\u06f9]/g, "")
}

/** تحقق اسم المرسل: كلمتان على الأقل وطول معقول. */
export function validateSenderName(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (trimmed.length < 5) return "اسم مرسل الحوالة قصير جداً — اكتب الاسم كما يظهر في الحوالة."
  if (trimmed.length > 80) return "اسم مرسل الحوالة طويل جداً."
  const words = trimmed.split(" ").filter((w) => w.length >= 2)
  if (words.length < 2) return "اكتب اسم المرسل من كلمتين على الأقل."
  if (!/^[\p{L}\s'.\-]+$/u.test(trimmed)) return "اسم المرسل يجب أن يحتوي حروفاً فقط."
  return ""
}

/** تحقق رقم هاتف المرسل: أرقام (يمني/سعودي أو محفظة أخرى)، 8 إلى 15 رقماً. */
export function validateSenderPhone(value: string): string {
  const digits = digitsOnly(value)
  if (value.trim().length === 0) return "أدخل رقم هاتف مرسل الحوالة."
  if (digits.length < 8 || digits.length > 15) return "رقم هاتف المرسل غير صالح (8 إلى 15 رقماً)."
  if (!/^\+?[\d\u0660-\u0669\u06f0-\u06f9\s().-]+$/.test(value.trim())) return "رقم هاتف المرسل يحتوي رموزاً غير مسموحة."
  return ""
}

/** تحقق رقم الحوالة: نص وليس رقماً، مع الحفاظ على الأصفار في البداية. */
export function validateTransferReference(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 4) return "رقم الحوالة قصير جداً."
  if (trimmed.length > 40) return "رقم الحوالة طويل جداً."
  if (digitsOnly(trimmed).length < 4) return "رقم الحوالة يجب أن يحتوي 4 أرقام على الأقل."
  if (!/^[\d\u0660-\u0669\u06f0-\u06f9A-Za-z\-/ ]+$/.test(trimmed)) {
    return "رقم الحوالة يحتوي رموزاً غير مسموحة."
  }
  return ""
}

/** يضغط الصورة على العميل عند الحاجة، مع الحفاظ على وضوح النص. */
async function compressProofImage(file: File): Promise<File> {
  if (file.size <= TARGET_PROOF_BYTES) return file
  if (typeof document === "undefined") return file

  const bitmapUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.crossOrigin = "anonymous"
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error("decode-failed"))
      element.src = bitmapUrl
    })

    const scale = Math.min(1, MAX_CLIENT_DIMENSION / Math.max(img.width, img.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    const ctx = canvas.getContext("2d")
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    let quality = 0.88
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/webp", quality),
      )
      if (!blob) break
      if (blob.size <= TARGET_PROOF_BYTES || attempt === 3) {
        return new File([blob], "payment-proof.webp", { type: "image/webp" })
      }
      quality = Math.max(0.6, quality - 0.1)
    }
    return file
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(bitmapUrl)
  }
}

export function PaymentSection({
  accounts,
  value,
  onChange,
  formattedTotal,
  encryptionReady,
  errors,
}: {
  accounts: PaymentAccount[]
  value: PaymentSelection
  onChange: (next: PaymentSelection) => void
  formattedTotal: string
  encryptionReady: boolean
  errors: { account?: string; senderName?: string; senderPhone?: string; reference?: string; proof?: string }
}) {
  const { toast } = useToast()
  const { payments } = useSiteConfig()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [proofError, setProofError] = useState("")
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const sorted = useMemo(
    () => [...accounts].sort((a, b) => a.sortOrder - b.sortOrder),
    [accounts],
  )
  const selectedAccount = sorted.find((a) => a.id === value.accountId) ?? null
  const transfer = value.method === "manual_transfer"

  // معاينة الصورة تُبنى من الملف الموجود في الذاكرة فقط.
  useEffect(() => {
    if (!value.proofFile) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(value.proofFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [value.proofFile])

  // إن عُطّلت طريقة من لوحة الإدارة وكانت هي المحددة، ننتقل للطريقة المتاحة تلقائياً.
  useEffect(() => {
    if (!payments.cashOnDelivery && value.method === "cash_on_delivery" && payments.manualTransfer) {
      onChange({ ...value, method: "manual_transfer" })
    } else if (!payments.manualTransfer && value.method === "manual_transfer" && payments.cashOnDelivery) {
      onChange({ ...EMPTY_PAYMENT_SELECTION, method: "cash_on_delivery" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments.cashOnDelivery, payments.manualTransfer])

  const chooseCashOnDelivery = () => {
    // العودة إلى الدفع عند الاستلام تمسح كل بيانات التحويل من حالة الصفحة.
    setProofError("")
    if (fileInputRef.current) fileInputRef.current.value = ""
    onChange({ ...EMPTY_PAYMENT_SELECTION, method: "cash_on_delivery" })
  }

  const chooseTransfer = () => {
    onChange({ ...value, method: "manual_transfer" })
    if (sorted.length > 0) setSheetOpen(true)
  }

  const copyAccountNumber = async (accountNumber: string) => {
    try {
      await navigator.clipboard.writeText(accountNumber)
      toast({ title: "تم نسخ رقم الحساب" })
    } catch {
      toast({ title: "تعذّر النسخ", description: "انسخ رقم الحساب يدوياً." })
    }
  }

  const handleFile = async (file: File | undefined) => {
    setProofError("")
    if (!file) return

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setProofError("الصيغة غير مدعومة. المسموح: JPEG أو PNG أو WebP فقط.")
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }
    if (file.size > MAX_PICK_BYTES) {
      setProofError("حجم الصورة كبير جداً. الرجاء اختيار صورة أوضح وأصغر حجماً.")
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }

    setProcessing(true)
    try {
      const prepared = await compressProofImage(file)
      if (prepared.size > TARGET_PROOF_BYTES) {
        setProofError("تعذّر تصغير الصورة بما يكفي. الرجاء اختيار صورة أوضح وأصغر حجماً.")
        if (fileInputRef.current) fileInputRef.current.value = ""
        return
      }
      onChange({ ...value, method: "manual_transfer", proofFile: prepared })
    } catch {
      setProofError("تعذّر قراءة الصورة. الرجاء اختيار صورة أخرى.")
    } finally {
      setProcessing(false)
    }
  }

  const removeProof = () => {
    setProofError("")
    if (fileInputRef.current) fileInputRef.current.value = ""
    onChange({ ...value, proofFile: null })
  }

  return (
    <section className="bg-card border border-border rounded-2xl p-5">
      <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
        <Wallet className="w-5 h-5 text-primary" aria-hidden="true" />
        طريقة الدفع
      </h2>

      {!payments.cashOnDelivery && !payments.manualTransfer && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          لا توجد طريقة دفع متاحة حالياً. تواصل معنا لإتمام طلبك.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="طريقة الدفع">
        {payments.cashOnDelivery && (
        <button
          type="button"
          role="radio"
          aria-checked={!transfer}
          onClick={chooseCashOnDelivery}
          className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-right transition-colors ${
            !transfer ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
        >
          <span className="flex items-center gap-2 font-bold text-sm">
            <Banknote className={`w-5 h-5 ${!transfer ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" />
            الدفع عند الاستلام
            {!transfer && <Check className="w-4 h-4 text-primary" aria-hidden="true" />}
          </span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            ادفع قيمة طلبك عند الاستلام.
          </span>
        </button>
        )}

        {payments.manualTransfer && (
        <button
          type="button"
          role="radio"
          aria-checked={transfer}
          onClick={chooseTransfer}
          className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-right transition-colors ${
            transfer ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
        >
          <span className="flex items-center gap-2 font-bold text-sm">
            <Wallet className={`w-5 h-5 ${transfer ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" />
            الدفع عبر حساب دفع
            {transfer && <Check className="w-4 h-4 text-primary" aria-hidden="true" />}
          </span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            حوّل قيمة الطلب إلى أحد الحسابات المتاحة، ثم أرسل بيانات الحوالة للتحقق منها.
          </span>
        </button>
        )}
      </div>

      {transfer && sorted.length === 0 && (
        <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600">
          لا توجد حسابات دفع متاحة حالياً. يمكنك استخدام الدفع عند الاستلام.
        </p>
      )}

      {transfer && sorted.length > 0 && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
            <span className="text-sm text-muted-foreground">المبلغ المطلوب تحويله</span>
            <span className="text-lg font-bold text-primary">{formattedTotal}</span>
          </div>

          {selectedAccount ? (
            <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                {selectedAccount.imageUrl ? (
                  <SafeImage
                    src={selectedAccount.imageUrl}
                    alt={selectedAccount.providerName}
                    width={48}
                    height={48}
                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Wallet className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm">{selectedAccount.providerName}</p>
                  <p className="text-xs text-muted-foreground">{selectedAccount.accountHolderName}</p>
                  <p className="mt-1 text-sm font-bold" dir="ltr">
                    {selectedAccount.accountNumber}
                  </p>
                  {selectedAccount.instructions && (
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {selectedAccount.instructions}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyAccountNumber(selectedAccount.accountNumber)}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold hover:border-primary/50"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  نسخ رقم الحساب
                </button>
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold hover:border-primary/50"
                >
                  تغيير الحساب
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="w-full rounded-xl border border-dashed border-primary/50 px-4 py-3 text-sm font-bold text-primary hover:bg-primary/5"
            >
              اختر حساب الدفع
            </button>
          )}
          {errors.account && <p className="text-xs text-destructive">{errors.account}</p>}

          {selectedAccount && (
            <div className="space-y-4 border-t border-border pt-4">
              <div>
                <label htmlFor="transfer-sender" className="mb-1.5 block text-sm font-bold">
                  اسم مرسل الحوالة
                </label>
                <input
                  id="transfer-sender"
                  type="text"
                  value={value.senderName}
                  onChange={(e) => onChange({ ...value, senderName: e.target.value })}
                  maxLength={80}
                  autoComplete="off"
                  placeholder="الاسم كما يظهر في الحوالة"
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                />
                {errors.senderName && <p className="mt-1 text-xs text-destructive">{errors.senderName}</p>}
              </div>

              <div>
                <label htmlFor="transfer-sender-phone" className="mb-1.5 block text-sm font-bold">
                  رقم هاتف المرسل
                </label>
                <input
                  id="transfer-sender-phone"
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  value={value.senderPhone}
                  onChange={(e) => onChange({ ...value, senderPhone: e.target.value })}
                  maxLength={25}
                  autoComplete="off"
                  placeholder="الرقم الذي حُوّل منه، مثل 771234567"
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                />
                {errors.senderPhone && <p className="mt-1 text-xs text-destructive">{errors.senderPhone}</p>}
              </div>

              <div>
                <label htmlFor="transfer-reference" className="mb-1.5 block text-sm font-bold">
                  رقم الحوالة
                </label>
                <input
                  id="transfer-reference"
                  type="text"
                  inputMode="text"
                  dir="ltr"
                  value={value.reference}
                  onChange={(e) => onChange({ ...value, reference: e.target.value })}
                  maxLength={40}
                  autoComplete="off"
                  placeholder="0012345678"
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  أدخل الرقم كما هو تماماً، مع الأصفار في بدايته إن وُجدت.
                </p>
                {errors.reference && <p className="mt-1 text-xs text-destructive">{errors.reference}</p>}
              </div>

              {/* إرفاق الصورة يحتاج تخزيناً مهيّأً للإثباتات؛ إن لم يكن مهيّأً نُخفي الحقل ويبقى الطلب ممكناً بدونها */}
              {encryptionReady ? (
              <div>
                <span className="mb-1.5 block text-sm font-bold">
                  صورة إثبات الحوالة <span className="font-normal text-muted-foreground">(اختياري)</span>
                </span>
                <p className="mb-2 text-xs text-muted-foreground">
                  يسرّع التحقق من الدفع، ولا يمنع إتمام الطلب إن لم ترفقها. المطلوب: اسم المرسل ورقم الحوالة.
                </p>
                <input
                  ref={fileInputRef}
                  id="transfer-proof"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                  className="sr-only"
                />

                {previewUrl ? (
                  <div className="rounded-xl border border-border p-3">
                    {/* معاينة محلية من ذاكرة المتصفح — لا تُرفع إلا مع الطلب */}
                    <img
                      src={previewUrl}
                      alt="معاينة إثبات الحوالة"
                      className="mx-auto max-h-56 w-auto rounded-lg object-contain"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:border-primary/50"
                      >
                        <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        استبدال الصورة
                      </button>
                      <button
                        type="button"
                        onClick={removeProof}
                        className="flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-bold text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        حذف الصورة
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={processing}
                    className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground hover:border-primary/50 disabled:opacity-70"
                  >
                    {processing ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                        جارٍ معالجة الصورة...
                      </>
                    ) : (
                      <>
                        <ImageIcon className="h-5 w-5" aria-hidden="true" />
                        اختر صورة إثبات الحوالة (JPEG أو PNG أو WebP)
                      </>
                    )}
                  </button>
                )}

                {(proofError || errors.proof) && (
                  <p className="mt-1 text-xs text-destructive">{proofError || errors.proof}</p>
                )}
              </div>
              ) : null}

              <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-600">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                سيبقى طلبك في حالة «جارٍ التحقق من الدفع» حتى تتم مراجعة بيانات الحوالة.
              </p>
            </div>
          )}
        </div>
      )}

      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>اختر حساب الدفع</DialogTitle>
            <DialogDescription>
              حوّل {formattedTotal} إلى الحساب الذي تختاره، ثم أرسل بيانات الحوالة.
            </DialogDescription>
          </DialogHeader>

          {/*
            شبكة بعمودين ثابتين — بطاقتان متجاورتان في كل سطر حتى على الهاتف،
            بلا تمرير أفقي. البطاقة الأخيرة عند العدد الفردي تبقى بعرض نصف الصف
            لأن العناصر لا تتمدد في grid ذات أعمدة ثابتة.
          */}
          <div
            className="grid max-h-[60vh] grid-cols-2 items-stretch gap-2.5 overflow-y-auto overflow-x-hidden p-0.5 sm:gap-3"
            role="radiogroup"
            aria-label="حسابات الدفع"
          >
            {sorted.map((account) => {
              const active = account.id === value.accountId
              const displayName = account.accountDisplayName || account.providerName
              const select = () => {
                onChange({ ...value, method: "manual_transfer", accountId: account.id })
                setSheetOpen(false)
              }
              return (
                // البطاقة كاملة قابلة للضغط، وزر النسخ داخلها زر حقيقي مستقل
                // لذلك نستخدم div بدور radio بدلاً من زر داخل زر.
                <div
                  key={account.id}
                  role="radio"
                  aria-checked={active}
                  tabIndex={0}
                  onClick={select}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      select()
                    }
                  }}
                  className={`flex h-full min-w-0 cursor-pointer flex-col gap-2 rounded-xl border p-3 text-right transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    active
                      ? "border-2 border-primary bg-primary/10 shadow-sm"
                      : "border border-border hover:border-primary/50"
                  }`}
                >
                  {/* صورة أو شعار الحساب */}
                  <div className="flex items-start justify-between gap-2">
                    {account.imageUrl ? (
                      <SafeImage
                        src={account.imageUrl}
                        alt={displayName}
                        width={44}
                        height={44}
                        className="h-11 w-11 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Wallet className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                      </span>
                    )}
                    {/* علامة الحساب المحدد */}
                    {active && (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
                        <Check className="h-4 w-4 text-primary-foreground" aria-hidden="true" />
                        <span className="sr-only">الحساب المحدد</span>
                      </span>
                    )}
                  </div>

                  {/* اسم الحساب — يستخدم كامل عرض البطاقة */}
                  <p className="line-clamp-2 w-full text-sm font-bold leading-snug break-words">
                    {displayName}
                  </p>

                  {/* رقم الحساب بالاتجاه LTR + زر النسخ أسفله */}
                  <div className="mt-auto w-full min-w-0">
                    <p
                      dir="ltr"
                      className="w-full truncate text-left font-mono text-[13px] font-bold tabular-nums"
                      title={account.accountNumber}
                    >
                      {account.accountNumber}
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        // النسخ لا يغيّر الحساب المحدد ولا يغلق النافذة.
                        e.stopPropagation()
                        copyAccountNumber(account.accountNumber)
                      }}
                      aria-label={`نسخ رقم حساب ${displayName}`}
                      className="mt-1.5 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2 py-2 text-xs font-bold transition-colors hover:border-primary/50 hover:bg-accent"
                    >
                      <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      نسخ الرقم
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* تفاصيل الحساب المختار كاملة — أسفل الشبكة لتبقى البطاقات مرتبة */}
          {selectedAccount && (
            <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-xs leading-relaxed">
              <p className="font-bold text-sm">{selectedAccount.providerName}</p>
              <p className="text-muted-foreground">
                صاحب الحساب: {selectedAccount.accountHolderName}
              </p>
              <p className="text-muted-foreground" dir="ltr">
                {selectedAccount.accountNumber}
              </p>
              {selectedAccount.instructions && (
                <p className="mt-1.5 text-muted-foreground">{selectedAccount.instructions}</p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-bold hover:border-primary/50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            إغلاق
          </button>
        </DialogContent>
      </Dialog>
    </section>
  )
}
