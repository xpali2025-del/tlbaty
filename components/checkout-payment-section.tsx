"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Banknote,
  Check,
  Copy,
  ImageIcon,
  Landmark,
  Loader2,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Wallet,
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
import { cn } from "@/lib/utils"
import type { PaymentAccount, PaymentMethod } from "@/lib/payment"

// ============================================
// قسم «طريقة الدفع» في صفحة إتمام الطلب
//
// الحالة مرفوعة إلى المكوّن الأب (checkout-client) لأن الإرسال يحتاجها،
// لكن كل منطق العرض والتحقق المبدئي والضغط يبقى هنا.
// صورة الإثبات تبقى في ذاكرة الصفحة فقط ولا تُحفظ في localStorage.
// ============================================

/** الحجم المستهدف بعد الضغط على العميل. */
const TARGET_PROOF_BYTES = Math.floor(1.2 * 1024 * 1024)

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
  wallet,
  errors,
}: {
  wallet?: { balance: number; frozen: boolean; formattedBalance: string; enough: boolean } | null
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

  const walletVisible = payments.wallet && !!wallet
  const walletUsable = walletVisible && !wallet!.frozen && wallet!.enough
  // رصيد لا يكفي (تغيّرت السلة مثلاً) بعد اختيار الرصيد: نعود للدفع عند الاستلام بدل إرسال طلب سيُرفض.
  useEffect(() => {
    if (value.method === "wallet" && wallet && !walletUsable) onChange({ ...EMPTY_PAYMENT_SELECTION, method: payments.cashOnDelivery ? "cash_on_delivery" : "manual_transfer" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletUsable])

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

  const copyAmount = async () => {
    // الرقم فقط بلا رمز العملة، ليُلصق مباشرة في تطبيق التحويل.
    const digits = formattedTotal.replace(/[^\d.,\u0660-\u0669\u06f0-\u06f9]/g, "")
    try {
      await navigator.clipboard.writeText(digits)
      toast({ title: "تم نسخ المبلغ" })
    } catch {
      toast({ title: "تعذّر النسخ", description: "انسخ المبلغ يدوياً." })
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
        <Wallet className="h-5 w-5 text-primary" aria-hidden="true" />
        طريقة الدفع
      </h2>

      {!payments.cashOnDelivery && !payments.manualTransfer && !walletVisible && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          لا توجد طريقة دفع متاحة حالياً. تواصل معنا لإتمام طلبك.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="طريقة الدفع">
        {payments.cashOnDelivery && (
          <MethodCard
            selected={value.method === "cash_on_delivery"}
            onSelect={chooseCashOnDelivery}
            icon={<Banknote className="h-5 w-5" aria-hidden="true" />}
            title="الدفع عند الاستلام"
            description="ادفع قيمة طلبك نقداً عند وصوله إليك."
            chip="بدون دفع مسبق"
          />
        )}
        {walletVisible && (
          <MethodCard
            selected={value.method === "wallet"}
            disabled={!walletUsable}
            onSelect={() => onChange({ ...EMPTY_PAYMENT_SELECTION, method: "wallet" })}
            icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
            title="الدفع من الرصيد"
            description={walletDescription(wallet!)}
            chip={wallet!.enough && !wallet!.frozen ? "دفع فوري" : "اشحن رصيدك"}
            href={!wallet!.enough && !wallet!.frozen ? "/account/wallet" : undefined}
          />
        )}
        {payments.manualTransfer && (
          <MethodCard
            selected={transfer}
            onSelect={chooseTransfer}
            icon={<Landmark className="h-5 w-5" aria-hidden="true" />}
            title="الدفع عبر حساب دفع"
            description="حوّل المبلغ إلى أحد حساباتنا ثم أدخل بيانات الحوالة."
            chip="تحويل وتحقق"
          />
        )}
      </div>

      {transfer && sorted.length === 0 && (
        <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
          لا توجد حسابات دفع متاحة حالياً. يمكنك استخدام الدفع عند الاستلام.
        </p>
      )}

      {transfer && sorted.length > 0 && (
        <div className="mt-5 space-y-6">
          {/* الخطوة 1: المبلغ والحساب */}
          <Step n={1} title="حوّل المبلغ إلى الحساب">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
              <div>
                <p className="text-xs text-muted-foreground">المبلغ المطلوب تحويله</p>
                <p className="text-xl font-bold text-primary">{formattedTotal}</p>
              </div>
              <button
                type="button"
                onClick={copyAmount}
                className="flex min-h-10 items-center gap-1.5 rounded-lg border border-primary/30 bg-card px-3 text-xs font-bold text-primary transition-colors hover:bg-primary/10"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                نسخ المبلغ
              </button>
            </div>

            {selectedAccount ? (
              <div className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-start gap-3">
                  <AccountLogo account={selectedAccount} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{selectedAccount.accountDisplayName || selectedAccount.providerName}</p>
                    <p className="text-xs text-muted-foreground">{selectedAccount.accountHolderName}</p>
                  </div>
                  {sorted.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSheetOpen(true)}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-primary hover:bg-primary/10"
                    >
                      تغيير
                    </button>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2">
                  <span dir="ltr" className="select-all font-mono text-base font-bold tracking-wide tabular-nums">
                    {selectedAccount.accountNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyAccountNumber(selectedAccount.accountNumber)}
                    className="flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-bold transition-colors hover:border-primary/50"
                    aria-label={`نسخ رقم حساب ${selectedAccount.providerName}`}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    نسخ
                  </button>
                </div>
                {selectedAccount.instructions && (
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{selectedAccount.instructions}</p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 px-4 py-4 text-sm font-bold text-primary transition-colors hover:bg-primary/5"
              >
                <Landmark className="h-4 w-4" aria-hidden="true" />
                اختر حساب الدفع
              </button>
            )}
            {errors.account && <p className="text-xs text-destructive">{errors.account}</p>}
          </Step>

          {selectedAccount && (
            <>
              {/* الخطوة 2: بيانات الحوالة */}
              <Step n={2} title="أدخل بيانات الحوالة">
                <Field id="transfer-sender" label="اسم مرسل الحوالة" error={errors.senderName}>
                  <input
                    id="transfer-sender"
                    type="text"
                    value={value.senderName}
                    onChange={(e) => onChange({ ...value, senderName: e.target.value })}
                    maxLength={80}
                    autoComplete="off"
                    placeholder="الاسم كما يظهر في الحوالة"
                    aria-invalid={Boolean(errors.senderName)}
                    className={inputClass(Boolean(errors.senderName))}
                  />
                </Field>

                <Field id="transfer-sender-phone" label="رقم هاتف المرسل" error={errors.senderPhone}>
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
                    aria-invalid={Boolean(errors.senderPhone)}
                    className={cn(inputClass(Boolean(errors.senderPhone)), "text-left")}
                  />
                </Field>

                <Field
                  id="transfer-reference"
                  label="رقم الحوالة"
                  hint="أدخل الرقم كما هو تماماً، مع الأصفار في بدايته إن وُجدت."
                  error={errors.reference}
                >
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
                    aria-invalid={Boolean(errors.reference)}
                    className={cn(inputClass(Boolean(errors.reference)), "text-left")}
                  />
                </Field>
              </Step>

              {/* الخطوة 3: إشعار الدفع (اختياري). إرفاقه يحتاج تخزيناً مهيّأً للإثباتات، وإلا نُخفيه ويبقى الطلب ممكناً بدونه. */}
              {encryptionReady ? (
                <Step n={3} title="إشعار الدفع" optional>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    أرفق صورة الإشعار لتسريع التحقق من الدفع. لا يمنع إتمام الطلب إن لم ترفقها.
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
                    <div className="rounded-xl border border-border bg-background p-3">
                      {/* معاينة محلية من ذاكرة المتصفح — لا تُرفع إلا مع الطلب */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previewUrl} alt="معاينة إشعار الدفع" className="mx-auto max-h-56 w-auto rounded-lg object-contain" />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-bold hover:border-primary/50"
                        >
                          <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          استبدال الصورة
                        </button>
                        <button
                          type="button"
                          onClick={removeProof}
                          className="flex min-h-9 items-center gap-1.5 rounded-lg border border-destructive/40 px-3 text-xs font-bold text-destructive hover:bg-destructive/10"
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
                      className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-6 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-70"
                    >
                      {processing ? (
                        <>
                          <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                          جارٍ معالجة الصورة...
                        </>
                      ) : (
                        <>
                          <UploadCloud className="h-6 w-6 text-primary" aria-hidden="true" />
                          <span className="font-bold text-foreground">اختر صورة الإشعار</span>
                          <span className="text-xs">JPEG أو PNG أو WebP</span>
                        </>
                      )}
                    </button>
                  )}

                  {(proofError || errors.proof) && <p className="text-xs text-destructive">{proofError || errors.proof}</p>}
                </Step>
              ) : null}

              <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-700">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                سيبقى طلبك في حالة «جارٍ التحقق من الدفع» حتى تتم مراجعة بيانات الحوالة.
              </p>
            </>
          )}
        </div>
      )}

      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>اختر حساب الدفع</DialogTitle>
            <DialogDescription>حوّل {formattedTotal} إلى الحساب الذي تختاره، ثم أدخل بيانات الحوالة.</DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] space-y-2.5 overflow-y-auto p-0.5" role="radiogroup" aria-label="حسابات الدفع">
            {sorted.map((account) => {
              const active = account.id === value.accountId
              const displayName = account.accountDisplayName || account.providerName
              const select = () => {
                onChange({ ...value, method: "manual_transfer", accountId: account.id })
                setSheetOpen(false)
              }
              return (
                // الصف كله قابل للضغط، وزر النسخ داخله زر حقيقي مستقل، فنستخدم div بدور radio لا زراً داخل زر.
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
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-right transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    active ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30" : "border-border hover:border-primary/40",
                  )}
                >
                  <AccountLogo account={account} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">{account.accountHolderName}</p>
                    <p dir="ltr" className="mt-0.5 truncate text-left font-mono text-sm font-bold tabular-nums" title={account.accountNumber}>
                      {account.accountNumber}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      // النسخ لا يغيّر الحساب المحدد ولا يغلق النافذة.
                      e.stopPropagation()
                      copyAccountNumber(account.accountNumber)
                    }}
                    aria-label={`نسخ رقم حساب ${displayName}`}
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:border-primary/50 hover:bg-accent"
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <RadioDot checked={active} />
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ---------- مكوّنات العرض المساعدة ----------

function RadioDot({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
      )}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </span>
  )
}

function walletDescription(wallet: { frozen: boolean; enough: boolean; formattedBalance: string }): string {
  if (wallet.frozen) return "محفظتك مجمّدة مؤقتاً. تواصل مع خدمة العملاء."
  if (wallet.enough) return `رصيدك ${wallet.formattedBalance} — يُخصم المبلغ فوراً ويُؤكَّد طلبك.`
  return `رصيدك ${wallet.formattedBalance} لا يكفي لهذا الطلب.`
}

function MethodCard({
  selected,
  onSelect,
  icon,
  title,
  description,
  chip,
  disabled,
  href,
}: {
  disabled?: boolean
  href?: string
  selected: boolean
  onSelect: () => void
  icon: React.ReactNode
  title: string
  description: string
  chip: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) {
          if (href) window.location.assign(href)
          return
        }
        onSelect()
      }}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-right transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        disabled && "opacity-70",
        selected ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30" : "border-border hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors",
          selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{description}</span>
        <span
          className={cn(
            "mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold",
            selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {chip}
        </span>
      </span>
      <RadioDot checked={selected} />
    </button>
  )
}

function AccountLogo({ account, size }: { account: PaymentAccount; size: number }) {
  return account.imageUrl ? (
    <SafeImage
      src={account.imageUrl}
      alt={account.providerName}
      width={size}
      height={size}
      className="shrink-0 rounded-xl object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-xl bg-muted" style={{ width: size, height: size }}>
      <Wallet className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
    </span>
  )
}

/** خطوة مرقّمة في مسار الحوالة، بخط جانبي يربط الخطوات ببعضها. */
function Step({ n, title, optional, children }: { n: number; title: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {n}
        </span>
        <h3 className="text-sm font-bold">{title}</h3>
        {optional && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">اختياري</span>}
      </div>
      <div className="space-y-3 ps-1 sm:ps-9">{children}</div>
    </div>
  )
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

const inputClass = (invalid: boolean) =>
  cn(
    "h-12 w-full rounded-xl border bg-background px-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:ring-2",
    invalid ? "border-destructive focus:border-destructive focus:ring-destructive/20" : "border-border focus:border-primary focus:ring-primary/20",
  )
