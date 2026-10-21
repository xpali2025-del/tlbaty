"use client"

import { useState, useTransition } from "react"
import {
  AlertTriangle,
  Banknote,
  Copy,
  Download,
  ExternalLink,
  History,
  ImageIcon,
  ShieldCheck,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { AdminOrder } from "@/lib/admin-orders"
import {
  PAYMENT_STATUS_LABELS,
  allowedPaymentTransitions,
  describePaymentMethod,
  initialPaymentStatus,
  type PaymentStatus,
} from "@/lib/payment"
import { updatePaymentStatus } from "../orders-actions"

// ============================================
// لوحة الدفع داخل تفاصيل الطلب في /manage
//
// - تعرض طريقة الدفع وحالة الدفع وSnapshot الحساب وبيانات الحوالة.
// - إثبات الحوالة يُعرض عبر المسار المحمي فقط (لا رابط خام).
// - الأزرار تتبع الانتقالات المسموحة فقط، ولا تلمس حالة الطلب إطلاقاً.
// - الطلبات القديمة بلا بيانات دفع تعرض «طريقة الدفع غير مسجلة».
// ============================================

export const PAYMENT_STATUS_BADGE: Record<PaymentStatus, string> = {
  pending_on_delivery: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  pending_verification: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  verified: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  rejected: "bg-destructive/15 text-destructive",
  paid: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  refunded: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  cancelled: "bg-muted text-muted-foreground",
}

/** نصوص أزرار الانتقال حسب الحالة الهدف. */
const ACTION_LABELS: Record<PaymentStatus, string> = {
  pending_on_delivery: "إرجاع إلى بانتظار التحصيل",
  pending_verification: "إعادة إلى التحقق",
  verified: "تم التحقق من الدفع",
  rejected: "رفض إثبات الدفع",
  paid: "تم تحصيل الدفع",
  refunded: "إعادة المبلغ",
  cancelled: "إلغاء الدفع",
}

function formatDate(iso?: string): string {
  if (!iso) return "-"
  try {
    return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    )
  } catch {
    return iso
  }
}

export function OrderPaymentPanel({ order }: { order: AdminOrder }) {
  const [isPending, startTransition] = useTransition()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [proofOpen, setProofOpen] = useState(false)

  const method = order.paymentMethod
  const status: PaymentStatus | undefined =
    order.paymentStatus ?? (method ? initialPaymentStatus(method) : undefined)
  const snapshot = order.paymentAccountSnapshot
  const proofUrl = `/api/manage/orders/${order._id}/payment-proof`

  // طلب قديم بلا بيانات دفع — نعرض رسالة واضحة بدل حدوث خطأ.
  if (!method || !status) {
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <p className="flex items-center gap-1.5 font-medium">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          طريقة الدفع غير مسجلة
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          هذا الطلب أُنشئ قبل تفعيل نظام الدفع، ولا يحتوي بيانات دفع.
        </p>
      </div>
    )
  }

  const transitions = allowedPaymentTransitions(method, status)

  const applyStatus = (next: PaymentStatus, rejectionReason?: string) => {
    startTransition(async () => {
      try {
        await updatePaymentStatus(order._id, next, { reason: rejectionReason })
        toast.success(`تم تحديث حالة الدفع: ${PAYMENT_STATUS_LABELS[next]}`)
        setRejectOpen(false)
        setReason("")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر تحديث حالة الدفع")
      }
    })
  }

  const copyNumber = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success("تم النسخ")
    } catch {
      toast.error("تعذّر النسخ")
    }
  }

  return (
    <div className={cn("rounded-md border bg-muted/30 p-3 text-sm", isPending && "opacity-60")}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 font-medium">
          {method === "cash_on_delivery" ? (
            <Banknote className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Wallet className="h-4 w-4 text-muted-foreground" />
          )}
          {describePaymentMethod(method, snapshot?.providerName)}
        </span>
        <Badge className={cn("border-0", PAYMENT_STATUS_BADGE[status])}>
          {PAYMENT_STATUS_LABELS[status]}
        </Badge>
        {order.duplicateTransferReference ? (
          <Badge className="border-0 bg-destructive/15 text-destructive">
            <AlertTriangle className="me-1 h-3 w-3" />
            رقم الحوالة مستخدم في طلب آخر ويحتاج مراجعة.
          </Badge>
        ) : null}
      </div>

      {method === "manual_transfer" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <dl className="grid gap-1 text-xs">
            <Row label="مزوّد الدفع" value={snapshot?.providerName ?? "-"} />
            <Row label="اسم صاحب الحساب" value={snapshot?.accountHolderName ?? "-"} />
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">رقم الحساب المستخدم</dt>
              <dd className="flex items-center gap-1.5">
                <span dir="ltr" className="font-mono">
                  {snapshot?.accountNumber ?? "-"}
                </span>
                {snapshot?.accountNumber ? (
                  <button
                    type="button"
                    onClick={() => copyNumber(snapshot.accountNumber as string)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="نسخ رقم الحساب"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </dd>
            </div>
            <Row label="اسم مرسل الحوالة" value={order.transferSenderName ?? "-"} />
            <Row label="رقم هاتف المرسل" value={order.transferSenderPhone ?? "-"} />
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">رقم الحوالة</dt>
              <dd className="flex items-center gap-1.5">
                <span dir="ltr" className="font-mono">
                  {order.transferReference ?? "-"}
                </span>
                {order.transferReference ? (
                  <button
                    type="button"
                    onClick={() => copyNumber(order.transferReference as string)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="نسخ رقم الحوالة"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </dd>
            </div>
            <Row label="وقت إرسال البيانات" value={formatDate(order.transferSubmittedAt)} />
            {order.paymentVerifiedAt ? (
              <Row label="وقت التحقق" value={formatDate(order.paymentVerifiedAt)} />
            ) : null}
            {order.paymentRejectedAt ? (
              <Row label="وقت الرفض" value={formatDate(order.paymentRejectedAt)} />
            ) : null}
            {order.paymentRejectionReason ? (
              <Row label="سبب الرفض" value={order.paymentRejectionReason} />
            ) : null}
            {order.paymentAdminNote ? (
              <Row label="ملاحظات الإدارة" value={order.paymentAdminNote} />
            ) : null}
          </dl>

          {/* إثبات الحوالة — عبر المسار المحمي فقط */}
          <div className="rounded-md border bg-background p-2">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              إثبات الحوالة (مشفّر — للإدارة فقط)
            </p>
            {order.hasPaymentProof ? (
              <>
                <button
                  type="button"
                  onClick={() => setProofOpen(true)}
                  className="block w-full overflow-hidden rounded border"
                  aria-label="عرض إثبات الحوالة بالحجم الكامل"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={proofUrl}
                    alt="معاينة مصغرة لإثبات الحوالة"
                    className="h-32 w-full bg-muted object-contain"
                    loading="lazy"
                  />
                </button>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" asChild>
                    <a href={proofUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3" />
                      فتح آمن
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" asChild>
                    <a href={`${proofUrl}?download=1`}>
                      <Download className="h-3 w-3" />
                      تنزيل
                    </a>
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  رُفع: {formatDate(order.paymentProofUploadedAt)}
                </p>
              </>
            ) : (
              <p className="flex items-center gap-1.5 py-4 text-xs text-muted-foreground">
                <ImageIcon className="h-3.5 w-3.5" />
                لم يرفق العميل صورة (اختيارية). طابق رقم الحوالة واسم المرسل مع كشف حسابك قبل التأكيد.
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          يدفع العميل قيمة الطلب عند الاستلام. حالة الدفع الحالية:{" "}
          {PAYMENT_STATUS_LABELS[status]}.
        </p>
      )}

      {/* أزرار انتقالات حالة الدفع */}
      {transitions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
          {transitions.map((next) => (
            <Button
              key={next}
              size="sm"
              variant={next === "rejected" || next === "cancelled" ? "outline" : "default"}
              disabled={isPending}
              className={cn(
                "h-8 text-xs",
                (next === "rejected" || next === "cancelled") &&
                  "border-destructive/40 text-destructive hover:bg-destructive/10",
              )}
              onClick={() => {
                if (next === "rejected") {
                  setRejectOpen(true)
                  return
                }
                applyStatus(next)
              }}
            >
              {ACTION_LABELS[next]}
            </Button>
          ))}
        </div>
      ) : (
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          لا توجد انتقالات متاحة لحالة الدفع الحالية.
        </p>
      )}

      {/* سجل تغييرات حالة الدفع */}
      {order.paymentStatusHistory && order.paymentStatusHistory.length > 0 ? (
        <details className="mt-3 border-t pt-3">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
            <History className="h-3.5 w-3.5" />
            سجل حالات الدفع ({order.paymentStatusHistory.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {order.paymentStatusHistory.map((entry, i) => (
              <li key={i} className="rounded border bg-background px-2 py-1.5 text-xs">
                <span className="font-medium">
                  {entry.status ? PAYMENT_STATUS_LABELS[entry.status] : "-"}
                </span>
                <span className="text-muted-foreground">
                  {" • "}
                  {entry.changedBy ?? "-"} • {formatDate(entry.changedAt)}
                </span>
                {entry.note ? <p className="mt-0.5 text-muted-foreground">{entry.note}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* نافذة رفض الإثبات — السبب مطلوب */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>رفض إثبات الدفع</DialogTitle>
            <DialogDescription>
              سبب الرفض مطلوب وسيُسجَّل في سجل حالات الدفع. لا تُحذف صورة الإثبات.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="مثال: رقم الحوالة غير مطابق للمبلغ المحوّل."
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={isPending}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              disabled={isPending || reason.trim().length < 3}
              onClick={() => applyStatus("rejected", reason)}
            >
              تأكيد الرفض
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة عرض الإثبات بالحجم المناسب */}
      <Dialog open={proofOpen} onOpenChange={setProofOpen}>
        <DialogContent className="max-w-3xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>إثبات الحوالة</DialogTitle>
            <DialogDescription>
              يُعرض من مسار محمي بجلسة الإدارة، ولا يمكن فتحه من رابط عام.
            </DialogDescription>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={proofUrl}
            alt="إثبات الحوالة"
            className="max-h-[70vh] w-full rounded-md bg-muted object-contain"
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  )
}
