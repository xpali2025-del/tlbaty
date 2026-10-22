"use client"

import { useState, useTransition } from "react"
import { AlertTriangle, Check, Lock, LockOpen, RefreshCw, Search, ShieldAlert, Wallet, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { AdminTopup, AdminWalletDetail, AdminWalletOverview } from "@/lib/admin-wallet"
import { MAX_ADMIN_ADJUST_BASE, WALLET_KIND_LABELS, type WalletKind } from "@/lib/wallet/rules"
import {
  adjustWallet,
  approveWalletTopup,
  lookupWallet,
  refreshWalletOverview,
  rejectWalletTopup,
  setWalletFrozen,
} from "../wallet-actions"
import { SectionHeader } from "./shared"

// إدارة الأرصدة: مراجعة طلبات الشحن، مراقبة التنبيهات، وفحص محفظة عميل (سجل كامل + تجميد + تعديل بسبب).
// كل المبالغ بالعملة الأساسية (ريال يمني قديم).

const fmt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ر.ي`
const date = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" }).format(new Date(iso)) : "—"

const SEVERITY_CLS = {
  high: "border-destructive/40 bg-destructive/10 text-destructive",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  info: "border-border bg-muted/50 text-muted-foreground",
} as const

export function WalletsManager({ initial }: { initial: AdminWalletOverview }) {
  const [overview, setOverview] = useState(initial)
  const [detail, setDetail] = useState<AdminWalletDetail | null>(null)
  const [query, setQuery] = useState("")
  const [pending, startTransition] = useTransition()

  const refresh = async () => {
    const r = await refreshWalletOverview()
    if (r.ok && "data" in r) setOverview(r.data)
  }
  const reloadDetail = async (q: string) => {
    const r = await lookupWallet(q)
    if (r.ok && "data" in r) setDetail(r.data ?? null)
  }
  const act = (fn: () => Promise<{ ok: boolean } & ({ message: string } | { error: string })>, after?: () => Promise<void>) =>
    startTransition(async () => {
      const r = await fn()
      if (r.ok) toast.success((r as { message: string }).message)
      else toast.error((r as { error: string }).error)
      await refresh()
      if (after) await after()
    })

  const search = () =>
    startTransition(async () => {
      const r = await lookupWallet(query)
      if (!r.ok) return void toast.error(r.error)
      const d = "data" in r ? r.data : null
      setDetail(d ?? null)
      if (!d) toast.message("لا يوجد عميل مطابق")
    })

  const { totals } = overview
  return (
    <div className="space-y-6">
      <SectionHeader title="المحافظ والرصيد" description="مراجعة طلبات الشحن، مراقبة الحركات المشبوهة، وإدارة أرصدة العملاء." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "إجمالي أرصدة العملاء", value: fmt(totals.liability) },
          { label: "عدد المحافظ", value: String(totals.wallets) },
          { label: "طلبات شحن معلّقة", value: `${totals.pendingCount} (${fmt(totals.pendingSum)})` },
          { label: "محافظ مجمّدة", value: String(totals.frozen) },
        ].map((c) => (
          <Card key={c.label} className="p-4">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{c.value}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-bold">
            <ShieldAlert className="size-4 text-primary" aria-hidden /> المراقبة والتنبيهات
          </h3>
          <Button variant="ghost" size="sm" onClick={() => act(async () => ({ ok: true, message: "تم تحديث المراقبة" }))} disabled={pending}>
            <RefreshCw className="me-1 size-4" aria-hidden /> فحص الآن
          </Button>
        </div>
        {overview.alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد تنبيهات. الدفتر متطابق مع الأرصدة ولا نشاط مشبوه.</p>
        ) : (
          <ul className="space-y-2">
            {overview.alerts.map((a, i) => (
              <li key={`${a.kind}-${a.customerId}-${i}`} className={cn("flex items-start justify-between gap-3 rounded-lg border p-3 text-sm", SEVERITY_CLS[a.severity])}>
                <span>
                  <AlertTriangle className="me-1 inline size-4" aria-hidden />
                  <span dir="ltr" className="font-mono">{a.phone}</span> — {a.text}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQuery(a.phone)
                    void reloadDetail(a.phone)
                  }}
                >
                  فتح
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 font-bold">طلبات الشحن بانتظار المراجعة ({overview.pending.length})</h3>
        {overview.pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد طلبات معلّقة.</p>
        ) : (
          <ul className="space-y-3">
            {overview.pending.map((t) => (
              <TopupReview key={t.id} topup={t} busy={pending} onAct={act} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-2 font-bold">
          <Wallet className="size-4 text-primary" aria-hidden /> فحص محفظة عميل
        </h3>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            search()
          }}
        >
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="رقم الهاتف أو معرّف العميل" dir="ltr" aria-label="بحث عن عميل" />
          <Button type="submit" disabled={pending || query.trim().length < 3}>
            <Search className="me-1 size-4" aria-hidden /> بحث
          </Button>
        </form>
        {detail && <WalletDetail detail={detail} busy={pending} onAct={(fn) => act(fn, () => reloadDetail(detail.phone))} />}
      </Card>

      {overview.recent.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-3 font-bold">آخر القرارات</h3>
          <ul className="divide-y divide-border text-sm">
            {overview.recent.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span dir="ltr" className="font-mono">{t.phone}</span> · {fmt(t.amountBase)} · <span dir="ltr">{t.reference}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  <Badge variant={t.status === "approved" ? "default" : "destructive"}>{t.status === "approved" ? "موافق" : "مرفوض"}</Badge> {t.reviewedBy} · {date(t.reviewedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

type Act = (fn: () => Promise<{ ok: boolean } & ({ message: string } | { error: string })>) => void

function TopupReview({ topup: t, busy, onAct }: { topup: AdminTopup; busy: boolean; onAct: Act }) {
  const [confirmed, setConfirmed] = useState("")
  const [reason, setReason] = useState("")
  const [rejecting, setRejecting] = useState(false)
  return (
    <li className="space-y-3 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold tabular-nums">
          {t.amount.toLocaleString("en-US")} {t.currencyCode} <span className="text-xs font-normal text-muted-foreground">(= {fmt(t.amountBase)})</span>
        </p>
        <div className="flex gap-1.5">
          {t.large && <Badge variant="secondary">مبلغ كبير</Badge>}
          {t.referenceUsedOnOrder && <Badge variant="destructive">رقم الحوالة مستخدم في طلب شراء</Badge>}
        </div>
      </div>
      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        <div><dt className="inline text-muted-foreground">العميل: </dt><dd className="inline font-mono" dir="ltr">{t.phone}</dd></div>
        <div><dt className="inline text-muted-foreground">الحساب: </dt><dd className="inline">{t.providerName} <span dir="ltr" className="font-mono">{t.accountNumber}</span></dd></div>
        <div><dt className="inline text-muted-foreground">المرسل: </dt><dd className="inline">{t.senderName}</dd></div>
        <div><dt className="inline text-muted-foreground">هاتف المرسل: </dt><dd className="inline font-mono" dir="ltr">{t.senderPhone}</dd></div>
        <div><dt className="inline text-muted-foreground">رقم الحوالة: </dt><dd className="inline font-mono" dir="ltr">{t.reference}</dd></div>
        <div><dt className="inline text-muted-foreground">الوقت: </dt><dd className="inline">{date(t.createdAt)}</dd></div>
      </dl>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">المبلغ المؤكَّد (اختياري — إن وصل أقل)</span>
          <Input value={confirmed} onChange={(e) => setConfirmed(e.target.value)} placeholder={String(t.amount)} dir="ltr" className="h-9 w-40" inputMode="decimal" />
        </label>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => onAct(() => approveWalletTopup(t.id, confirmed.trim() ? Number(confirmed) : undefined))}
        >
          <Check className="me-1 size-4" aria-hidden /> موافقة وإضافة الرصيد
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting((v) => !v)}>
          <X className="me-1 size-4" aria-hidden /> رفض
        </Button>
      </div>
      {rejecting && (
        <div className="flex gap-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الرفض (يظهر للعميل)" className="h-9" aria-label="سبب الرفض" />
          <Button size="sm" variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => onAct(() => rejectWalletTopup(t.id, reason))}>
            تأكيد الرفض
          </Button>
        </div>
      )}
    </li>
  )
}

function WalletDetail({ detail: d, busy, onAct }: { detail: AdminWalletDetail; busy: boolean; onAct: Act }) {
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [freezeReason, setFreezeReason] = useState("")
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-3">
        <div>
          <p className="font-mono text-sm" dir="ltr">{d.phone} · {d.publicId}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums" data-testid="admin-wallet-balance">{fmt(d.balance)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {d.consistent ? <Badge>الدفتر متطابق</Badge> : <Badge variant="destructive">الدفتر غير متطابق ({fmt(d.ledgerSum)})</Badge>}
          {d.frozen && <Badge variant="destructive">مجمّدة{d.frozenReason ? `: ${d.frozenReason}` : ""}</Badge>}
          {d.customerStatus === "blocked" && <Badge variant="destructive">العميل محظور</Badge>}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border p-3">
          <h4 className="text-sm font-bold">تعديل يدوي (يُسجَّل باسمك مع السبب)</h4>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`المبلغ (حتى ${MAX_ADMIN_ADJUST_BASE.toLocaleString("en-US")})`} dir="ltr" inputMode="decimal" aria-label="مبلغ التعديل" />
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="السبب (إلزامي)" aria-label="سبب التعديل" />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !(Number(amount) > 0) || reason.trim().length < 5} onClick={() => onAct(() => adjustWallet(d.customerId, "credit", Number(amount), reason))}>
              إضافة
            </Button>
            <Button size="sm" variant="outline" disabled={busy || !(Number(amount) > 0) || reason.trim().length < 5} onClick={() => onAct(() => adjustWallet(d.customerId, "debit", Number(amount), reason))}>
              خصم
            </Button>
          </div>
        </div>
        <div className="space-y-2 rounded-lg border border-border p-3">
          <h4 className="text-sm font-bold">{d.frozen ? "فك التجميد" : "تجميد المحفظة"}</h4>
          {!d.frozen && <Input value={freezeReason} onChange={(e) => setFreezeReason(e.target.value)} placeholder="سبب التجميد" aria-label="سبب التجميد" />}
          <Button
            size="sm"
            variant={d.frozen ? "default" : "destructive"}
            disabled={busy || (!d.frozen && freezeReason.trim().length < 3)}
            onClick={() => onAct(() => setWalletFrozen(d.customerId, !d.frozen, freezeReason))}
          >
            {d.frozen ? <LockOpen className="me-1 size-4" aria-hidden /> : <Lock className="me-1 size-4" aria-hidden />}
            {d.frozen ? "فك التجميد" : "تجميد"}
          </Button>
          <p className="text-xs text-muted-foreground">المحفظة المجمّدة لا تدفع ولا تُشحن؛ المبالغ المُرجَعة من الطلبات الملغاة تصل إليها.</p>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-bold">الدفتر (آخر {d.transactions.length} حركة)</h4>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-2 text-start">الوقت</th><th className="p-2 text-start">النوع</th><th className="p-2 text-start">المبلغ</th><th className="p-2 text-start">الرصيد بعد</th><th className="p-2 text-start">بواسطة</th><th className="p-2 text-start">ملاحظة / سبب</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.transactions.map((t) => (
                <tr key={t.id}>
                  <td className="p-2">{date(t.createdAt)}</td>
                  <td className="p-2">{WALLET_KIND_LABELS[t.kind as WalletKind] ?? t.kind}</td>
                  <td className={cn("p-2 font-bold tabular-nums", t.amount > 0 ? "text-emerald-600" : "")}>{t.amount > 0 ? "+" : ""}{fmt(t.amount)}</td>
                  <td className="p-2 tabular-nums">{fmt(t.balanceAfter)}</td>
                  <td className="p-2">{t.actor}</td>
                  <td className="p-2">{[t.note, t.reason].filter(Boolean).join(" — ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {d.audit.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-bold">سجل الأحداث الأمنية</h4>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {d.audit.map((a) => (
              <li key={a.id}>
                {date(a.createdAt)} — <span className="font-medium text-foreground">{a.action}</span> — {a.actor}
                {a.detail ? ` — ${JSON.stringify(a.detail)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
