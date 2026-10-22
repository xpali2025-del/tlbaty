"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowDownLeft, ArrowUpRight, Loader2, ShieldCheck, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { formatPrice, type Currency } from "@/lib/currency"
import { MAX_BALANCE_BASE, MAX_TOPUP_BASE, MIN_TOPUP_BASE, WALLET_KIND_LABELS, type WalletKind } from "@/lib/wallet/rules"
import { isValidSenderName, isValidTransferReference } from "@/lib/payment-input"
import { validateSenderPhone } from "@/components/checkout-payment-section"
import type { WalletSummary } from "@/lib/wallet/customer"

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: "قيد المراجعة", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  approved: { label: "تمت الموافقة", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  rejected: { label: "مرفوض", cls: "bg-red-500/15 text-red-700 dark:text-red-400" },
  cancelled: { label: "ملغى", cls: "bg-muted text-muted-foreground" },
}

const fmtDate = (iso: string) => new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" }).format(new Date(iso))

const inputCls = "h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"

export function WalletClient({
  summary,
  accounts,
  currencies,
  defaultCurrency,
}: {
  summary: WalletSummary
  accounts: { id: string; providerName: string; accountHolderName: string; accountNumber: string }[]
  currencies: Currency[]
  defaultCurrency: string
}) {
  const router = useRouter()
  const { toast } = useToast()
  const base = currencies.find((c) => c.code === "YER") ?? currencies[0]
  const [currencyCode, setCurrencyCode] = useState(currencies.some((c) => c.code === defaultCurrency) ? defaultCurrency : currencies[0]?.code ?? "YER")
  const currency = currencies.find((c) => c.code === currencyCode) ?? base
  const fmt = (b: number, c: Currency = currency) => formatPrice(b, c)

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ amount: "", accountId: accounts[0]?.id ?? "", senderName: "", senderPhone: "", reference: "" })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const account = accounts.find((a) => a.id === form.accountId)
  const amountNum = Number(form.amount)
  const amountBase = useMemo(() => (Number.isFinite(amountNum) && amountNum > 0 ? amountNum * currency.rate : 0), [amountNum, currency.rate])

  const validate = () => {
    const e: Record<string, string> = {}
    if (!(amountBase > 0)) e.amount = "أدخل مبلغاً صحيحاً."
    else if (amountBase < MIN_TOPUP_BASE) e.amount = `الحد الأدنى للشحن ${fmt(MIN_TOPUP_BASE)}.`
    else if (amountBase > MAX_TOPUP_BASE) e.amount = `الحد الأقصى للشحن في العملية الواحدة ${fmt(MAX_TOPUP_BASE)}.`
    else if (summary.balance + amountBase > MAX_BALANCE_BASE) e.amount = `الحد الأقصى لرصيد المحفظة ${fmt(MAX_BALANCE_BASE)}.`
    if (!account) e.accountId = "اختر حساب الدفع الذي حوّلت إليه."
    if (!isValidSenderName(form.senderName.trim().replace(/\s+/g, " "))) e.senderName = "اكتب اسم المرسل كما يظهر في الحوالة (كلمتان على الأقل)."
    const ph = validateSenderPhone(form.senderPhone)
    if (ph) e.senderPhone = ph
    if (!isValidTransferReference(form.reference.trim())) e.reference = "رقم الحوالة غير صالح."
    return e
  }

  const submit = async () => {
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const res = await fetch("/api/wallet/topups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountNum,
          currencyCode,
          paymentAccountId: form.accountId,
          senderName: form.senderName,
          senderPhone: form.senderPhone,
          reference: form.reference,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        toast({ title: "تم إرسال طلب الشحن", description: "سيُضاف الرصيد بعد أن تتحقق الإدارة من الحوالة." })
        setForm((f) => ({ ...f, amount: "", reference: "" }))
        setOpen(false)
        router.refresh()
      } else if (res.status === 401) {
        router.push("/login?next=/account/wallet")
      } else {
        toast({ title: "تعذّر إرسال الطلب", description: data?.message ?? "حاول مجدداً." })
      }
    } catch {
      toast({ title: "تعذّر إرسال الطلب", description: "تأكد من اتصالك وحاول مجدداً." })
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (id: string) => {
    const res = await fetch(`/api/wallet/topups/${id}/cancel`, { method: "POST" })
    const data = await res.json().catch(() => null)
    toast({ title: res.ok ? "تم إلغاء الطلب" : "تعذّر الإلغاء", description: res.ok ? undefined : data?.message })
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Wallet className="size-4" aria-hidden /> الرصيد المتاح
        </p>
        <p className="mt-1 text-3xl font-bold text-primary tabular-nums" data-testid="wallet-balance">
          {fmt(summary.balance)}
        </p>
        {currencies.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="عملة العرض">
            {currencies.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => setCurrencyCode(c.code)}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium", c.code === currencyCode ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card")}
              >
                {c.symbol}
              </button>
            ))}
          </div>
        )}
        {summary.frozen ? (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">محفظتك مجمّدة مؤقتاً. تواصل مع خدمة العملاء.</p>
        ) : (
          <Button className="mt-4" onClick={() => setOpen((v) => !v)} data-testid="wallet-topup-toggle">
            {open ? "إخفاء" : "شحن الرصيد"}
          </Button>
        )}
      </section>

      {open && !summary.frozen && (
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5" aria-label="طلب شحن رصيد">
          <p className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            حوّل المبلغ إلى أحد حساباتنا ثم أدخل بيانات الحوالة. يُضاف الرصيد بعد أن تتحقق الإدارة منها، ولا يُضاف قبل ذلك.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">الحساب الذي حوّلت إليه</span>
            <select value={form.accountId} onChange={set("accountId")} className={inputCls} aria-label="حساب الدفع">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.providerName} — {a.accountHolderName}
                </option>
              ))}
            </select>
            {account && (
              <span className="mt-1 block text-xs text-muted-foreground" dir="ltr">
                {account.accountNumber}
              </span>
            )}
            {errors.accountId && <span className="mt-1 block text-xs text-destructive">{errors.accountId}</span>}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">المبلغ المحوَّل ({currency.symbol})</span>
            <input inputMode="decimal" value={form.amount} onChange={set("amount")} className={inputCls} dir="ltr" aria-label="المبلغ" />
            {errors.amount && <span className="mt-1 block text-xs text-destructive">{errors.amount}</span>}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">اسم مرسل الحوالة</span>
            <input value={form.senderName} onChange={set("senderName")} className={inputCls} aria-label="اسم المرسل" />
            {errors.senderName && <span className="mt-1 block text-xs text-destructive">{errors.senderName}</span>}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">رقم هاتف المرسل</span>
            <input inputMode="tel" value={form.senderPhone} onChange={set("senderPhone")} className={inputCls} dir="ltr" aria-label="هاتف المرسل" />
            {errors.senderPhone && <span className="mt-1 block text-xs text-destructive">{errors.senderPhone}</span>}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">رقم الحوالة</span>
            <input value={form.reference} onChange={set("reference")} className={inputCls} dir="ltr" aria-label="رقم الحوالة" />
            {errors.reference && <span className="mt-1 block text-xs text-destructive">{errors.reference}</span>}
          </label>
          <Button onClick={submit} disabled={busy} className="w-full" data-testid="wallet-topup-submit">
            {busy && <Loader2 className="me-2 size-4 animate-spin" aria-hidden />}
            إرسال طلب الشحن
          </Button>
        </section>
      )}

      {summary.topups.length > 0 && (
        <section className="rounded-2xl border border-border bg-card">
          <h2 className="border-b border-border px-4 py-3 text-sm font-bold">طلبات الشحن</h2>
          <ul className="divide-y divide-border">
            {summary.topups.map((t) => {
              const st = STATUS_LABELS[t.status] ?? STATUS_LABELS.cancelled
              return (
                <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium tabular-nums">
                      {t.amount.toLocaleString("en-US")} {currencies.find((c) => c.code === t.currencyCode)?.symbol ?? t.currencyCode}
                    </p>
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {t.providerName} · {t.reference}
                    </p>
                    <p className="text-xs text-muted-foreground">{fmtDate(t.createdAt)}</p>
                    {t.rejectionReason && <p className="mt-1 text-xs text-destructive">سبب الرفض: {t.rejectionReason}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", st.cls)}>{st.label}</span>
                    {t.status === "pending" && (
                      <button type="button" onClick={() => cancel(t.id)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive">
                        إلغاء الطلب
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card">
        <h2 className="border-b border-border px-4 py-3 text-sm font-bold">حركات الرصيد</h2>
        {summary.transactions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">لا توجد حركات بعد.</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="wallet-transactions">
            {summary.transactions.map((t) => {
              const credit = t.amount > 0
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", credit ? "bg-emerald-500/15 text-emerald-600" : "bg-orange-500/15 text-orange-600")}>
                      {credit ? <ArrowDownLeft className="size-4" aria-hidden /> : <ArrowUpRight className="size-4" aria-hidden />}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium">{WALLET_KIND_LABELS[t.kind as WalletKind] ?? t.kind}</p>
                      <p className="truncate text-xs text-muted-foreground">{[t.note, fmtDate(t.createdAt)].filter(Boolean).join(" · ")}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-end tabular-nums">
                    <p className={cn("font-bold", credit ? "text-emerald-600" : "text-foreground")}>
                      {credit ? "+" : "−"}
                      {fmt(Math.abs(t.amount))}
                    </p>
                    <p className="text-[11px] text-muted-foreground">الرصيد {fmt(t.balanceAfter)}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
