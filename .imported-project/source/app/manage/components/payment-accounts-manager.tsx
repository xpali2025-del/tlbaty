"use client"

import { useMemo, useState, useTransition } from "react"
import Image from "next/image"
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Eye,
  Pencil,
  Wallet,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { AdminPaymentAccount } from "@/lib/admin"
import { INITIAL_PAYMENT_PROVIDERS } from "@/lib/payment"
import {
  deletePaymentAccount,
  savePaymentAccount,
  togglePaymentAccount,
  updatePaymentAccountOrder,
} from "../payment-accounts-actions"
import { DeleteButton, ImageField, SectionHeader } from "./shared"

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

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success("تم نسخ رقم الحساب")
  } catch {
    toast.error("تعذّر النسخ من المتصفح")
  }
}

export function PaymentAccountsManager({ accounts }: { accounts: AdminPaymentAccount[] }) {
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<AdminPaymentAccount | null>(null)
  const [open, setOpen] = useState(false)
  const [previewing, setPreviewing] = useState<AdminPaymentAccount | null>(null)
  const [isPending, startTransition] = useTransition()

  const sorted = useMemo(
    () =>
      [...accounts].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.providerName.localeCompare(b.providerName, "ar"),
      ),
    [accounts],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((a) =>
      [a.providerName, a.accountDisplayName, a.accountHolderName, a.accountNumber]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    )
  }, [sorted, search])

  function run(action: () => Promise<void>, success: string) {
    startTransition(async () => {
      try {
        await action()
        toast.success(success)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر تنفيذ العملية")
      }
    })
  }

  function move(account: AdminPaymentAccount, direction: -1 | 1) {
    const index = sorted.findIndex((a) => a._id === account._id)
    const target = sorted[index + direction]
    if (!target) return
    // نتبادل قيم الترتيب بين الحسابين المتجاورين.
    run(async () => {
      await updatePaymentAccountOrder(account._id, target.sortOrder)
      await updatePaymentAccountOrder(target._id, account.sortOrder)
    }, "تم تغيير الترتيب")
  }

  return (
    <div>
      <SectionHeader
        title="حسابات الدفع"
        description="حسابات استقبال الحوالات التي تظهر للعميل عند اختيار الدفع عبر حساب دفع. الحساب المعطّل لا يظهر للعملاء ولا يؤثر على الطلبات السابقة."
        onAdd={() => {
          setEditing(null)
          setOpen(true)
        }}
        addLabel="حساب جديد"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث بالمزوّد أو صاحب الحساب أو رقم الحساب..."
      />

      {visible.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <Wallet className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">لا توجد حسابات دفع</p>
          <p className="text-sm text-muted-foreground">
            أضف حساباً (خدمة حاسب، جيب، جوالي، قطبي أو غيرها) ليتمكن العملاء من التحويل إليه.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((account, i) => (
            <Card
              key={account._id}
              className={cn("flex flex-col gap-3 p-4 sm:flex-row sm:items-center", isPending && "opacity-60")}
            >
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-muted">
                {account.image ? (
                  <Image src={account.image} alt="" fill className="object-cover" unoptimized />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">
                    <Wallet className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold">{account.providerName}</p>
                  {account.accountDisplayName ? (
                    <span className="text-xs text-muted-foreground">{account.accountDisplayName}</span>
                  ) : null}
                  <Badge
                    className={cn(
                      "border-0",
                      account.isActive
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {account.isActive ? "مُفعّل" : "معطّل"}
                  </Badge>
                  <span className="rounded-full bg-muted px-2 text-xs text-muted-foreground">
                    ترتيب {account.sortOrder}
                  </span>
                </div>
                <p className="mt-0.5 text-sm">{account.accountHolderName ?? "-"}</p>
                <p className="font-mono text-sm text-muted-foreground" dir="ltr">
                  {account.accountNumber ?? "-"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  آخر تعديل: {formatDate(account.updatedAt)}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="تحريك للأعلى"
                    disabled={isPending || i === 0}
                    onClick={() => move(account, -1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="تحريك للأسفل"
                    disabled={isPending || i === visible.length - 1}
                    onClick={() => move(account, 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="نسخ رقم الحساب"
                  onClick={() => copyText(account.accountNumber ?? "")}
                >
                  <Copy className="h-4 w-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="معاينة"
                  onClick={() => setPreviewing(account)}
                >
                  <Eye className="h-4 w-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="تعديل"
                  onClick={() => {
                    setEditing(account)
                    setOpen(true)
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>

                <div className="flex items-center gap-1.5 ps-1">
                  <Switch
                    checked={account.isActive}
                    disabled={isPending}
                    aria-label={account.isActive ? "تعطيل الحساب" : "تفعيل الحساب"}
                    onCheckedChange={(checked) =>
                      run(
                        () => togglePaymentAccount(account._id, checked),
                        checked ? "تم تفعيل الحساب" : "تم تعطيل الحساب",
                      )
                    }
                  />
                </div>

                <DeleteButton
                  onConfirm={() =>
                    run(() => deletePaymentAccount(account._id), "تم حذف الحساب")
                  }
                  itemLabel={`${account.providerName} — ${account.accountNumber ?? ""}`}
                  disabled={isPending}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-4 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        يُفضّل تعطيل الحساب بدلاً من حذفه إذا استُخدم في طلبات سابقة. الطلبات القديمة تحتفظ بنسخة
        ثابتة من بيانات الحساب، فلا يتغيّر أي طلب سابق عند التعديل أو الحذف.
      </p>

      <PaymentAccountDialog
        key={editing?._id ?? "new"}
        open={open}
        onOpenChange={setOpen}
        account={editing}
      />

      <PreviewDialog account={previewing} onClose={() => setPreviewing(null)} />
    </div>
  )
}

function PaymentAccountDialog({
  open,
  onOpenChange,
  account,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  account: AdminPaymentAccount | null
}) {
  const [isActive, setIsActive] = useState(account?.isActive ?? true)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    form.set("isActive", isActive ? "true" : "false")
    startTransition(async () => {
      try {
        await savePaymentAccount(account?._id ?? null, form)
        toast.success(account ? "تم تحديث الحساب" : "تمت إضافة الحساب")
        onOpenChange(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "تعذّر الحفظ")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{account ? "تعديل حساب الدفع" : "حساب دفع جديد"}</DialogTitle>
          <DialogDescription>
            تظهر هذه البيانات للعميل عند اختيار الدفع عبر حساب دفع.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="providerName">
              مزوّد الدفع <span className="text-destructive">*</span>
            </Label>
            <Input
              id="providerName"
              name="providerName"
              list="payment-providers"
              defaultValue={account?.providerName}
              placeholder="خدمة حاسب / جيب / جوالي / قطبي أو مزوّد جديد"
              required
            />
            <datalist id="payment-providers">
              {INITIAL_PAYMENT_PROVIDERS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              اختر من القائمة المقترحة أو اكتب اسم مزوّد جديد.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="accountDisplayName">الاسم الظاهر للحساب</Label>
            <Input
              id="accountDisplayName"
              name="accountDisplayName"
              defaultValue={account?.accountDisplayName}
              placeholder="جوالي — الحساب الرئيسي"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="accountHolderName">
              اسم صاحب الحساب <span className="text-destructive">*</span>
            </Label>
            <Input
              id="accountHolderName"
              name="accountHolderName"
              defaultValue={account?.accountHolderName}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="accountNumber">
              رقم الحساب <span className="text-destructive">*</span>
            </Label>
            <Input
              id="accountNumber"
              name="accountNumber"
              defaultValue={account?.accountNumber}
              required
              dir="ltr"
              inputMode="text"
              className="font-mono"
              placeholder="0771234567"
            />
            <p className="text-xs text-muted-foreground">
              يُحفظ كنص، فلا تضيع الأصفار في بداية الرقم.
            </p>
          </div>

          <ImageField
            name="image"
            label="صورة أو شعار الحساب (اختياري)"
            current={account?.image}
          />

          <div className="flex flex-col gap-2">
            <Label htmlFor="instructions">تعليمات الدفع (اختيارية)</Label>
            <Textarea
              id="instructions"
              name="instructions"
              rows={3}
              defaultValue={account?.instructions}
              placeholder="حوّل المبلغ ثم أرسل رقم الحوالة وصورة الإشعار."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sortOrder">ترتيب الظهور</Label>
              <Input
                id="sortOrder"
                name="sortOrder"
                type="number"
                min={0}
                step={1}
                defaultValue={account?.sortOrder ?? 0}
              />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border p-3">
              <Label htmlFor="isActive-switch">الحساب مُفعّل</Label>
              <Switch id="isActive-switch" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "جارٍ الحفظ..." : "حفظ التغييرات"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** معاينة الحساب كما يراه العميل في صفحة إتمام الطلب. */
function PreviewDialog({
  account,
  onClose,
}: {
  account: AdminPaymentAccount | null
  onClose: () => void
}) {
  return (
    <Dialog open={Boolean(account)} onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>معاينة الحساب</DialogTitle>
          <DialogDescription>هكذا يظهر الحساب للعميل.</DialogDescription>
        </DialogHeader>
        {account ? (
          <div className="rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border bg-muted">
                {account.image ? (
                  <Image src={account.image} alt="" fill className="object-cover" unoptimized />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">
                    <Wallet className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="font-bold">{account.providerName}</p>
                <p className="text-sm text-muted-foreground">{account.accountHolderName}</p>
              </div>
              {account.isActive ? (
                <Check className="ms-auto h-5 w-5 text-emerald-600" aria-hidden="true" />
              ) : (
                <X className="ms-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <p className="mt-3 font-mono text-sm" dir="ltr">
              {account.accountNumber}
            </p>
            {account.instructions ? (
              <p className="mt-2 text-xs text-muted-foreground">{account.instructions}</p>
            ) : null}
            {!account.isActive ? (
              <p className="mt-3 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                هذا الحساب معطّل حالياً ولن يظهر للعملاء.
              </p>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
