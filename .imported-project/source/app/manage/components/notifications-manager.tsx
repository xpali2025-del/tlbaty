"use client"

import { useMemo, useState, useTransition } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  Archive,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Bell,
  Eye,
  FileText,
  Link2,
  Pencil,
  RefreshCw,
  Send,
  Undo2,
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
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { AdminNotificationsResult } from "@/lib/admin-notifications"
import { sanitizeInternalLink } from "@/sanity/notifications/internal-link"
import {
  NOTIFICATION_LIMITS,
  NOTIFICATION_PRIORITY_LABELS,
  NOTIFICATION_STATUS_LABELS,
  type AdminNotification,
  type NotificationActionResult,
  type NotificationPriority,
  type NotificationStatus,
} from "@/sanity/notifications/types"
import {
  archiveNotification,
  deleteNotification,
  publishNotification,
  saveNotification,
  unpublishNotification,
} from "../notifications-actions"
import { DeleteButton, ImageField, SectionHeader } from "./shared"

// ============================================
// إدارة الإشعارات الداخلية داخل لوحة /manage
// كل عمليات الكتابة تُنفَّذ في Server Actions — لا توكن ولا كتابة من المتصفح.
// ============================================

type StatusFilter = "all" | NotificationStatus
type SortOrder = "newest" | "oldest"

function formatDateTime(iso: string | null): string {
  if (!iso) return "-"
  try {
    return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    )
  } catch {
    return iso
  }
}

/** يحوّل ISO إلى القيمة التي يتوقعها input[type=datetime-local] بالتوقيت المحلي. */
function toLocalInputValue(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date()
  if (Number.isNaN(date.getTime())) return ""
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const STATUS_STYLES: Record<NotificationStatus, string> = {
  published: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  draft: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  archived: "bg-muted text-muted-foreground",
}

export function NotificationsManager({ data }: { data: AdminNotificationsResult }) {
  const router = useRouter()
  const { notifications, stats, config, loadError } = data

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [sort, setSort] = useState<SortOrder>("newest")
  const [editing, setEditing] = useState<AdminNotification | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [previewing, setPreviewing] = useState<AdminNotification | null>(null)
  const [isPending, startTransition] = useTransition()

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = notifications.filter((n) => {
      if (statusFilter !== "all" && n.status !== statusFilter) return false
      if (!q) return true
      return n.title.toLowerCase().includes(q)
    })

    return filtered.sort((a, b) => {
      const at = new Date(a.publishedAt ?? a.updatedAt ?? a.createdAt ?? 0).getTime()
      const bt = new Date(b.publishedAt ?? b.updatedAt ?? b.createdAt ?? 0).getTime()
      return sort === "newest" ? bt - at : at - bt
    })
  }, [notifications, search, statusFilter, sort])

  /** ينفّذ إجراءً خادمياً ويعرض نتيجته الحقيقية (لا نجاح قبل نجاح الكتابة). */
  function runAction(action: () => Promise<NotificationActionResult>) {
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  // مشروع الإشعارات غير مهيأ — رسالة إعداد واضحة بأسماء المتغيرات فقط.
  if (!config.ready) {
    return (
      <div>
        <SectionHeader title="الإشعارات" description="إشعارات داخلية تظهر للعملاء في شاشة الإشعارات." />
        <Card className="flex flex-col gap-3 border-amber-500/40 bg-amber-500/5 p-6">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <h2 className="font-bold">مشروع الإشعارات غير مهيأ بعد</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            الإشعارات تُحفظ في مشروع Sanity ثالث مستقل تماماً عن مشروع المنتجات ومشروع الطلبات. أضف
            المتغيرات التالية في إعدادات المشروع ثم أعد تحميل الصفحة:
          </p>
          <ul className="flex flex-col gap-1.5">
            {config.missing.map((name) => (
              <li
                key={name}
                // break-all يمنع خروج أسماء المتغيرات الطويلة عن حدود الشاشة الصغيرة
                className="rounded-md border bg-background px-3 py-2 font-mono text-[11px] break-all"
                dir="ltr"
              >
                {name}
              </li>
            ))}
          </ul>
          <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-bold text-foreground">خطوات سريعة</p>
            <ol className="flex list-decimal flex-col gap-1 ps-4">
              <li>أنشئ مشروعاً جديداً في sanity.io/manage مخصصاً للإشعارات فقط.</li>
              <li>انسخ Project ID الخاص به إلى المتغير العام للإشعارات.</li>
              <li>
                أنشئ API Token بصلاحية Editor <span dir="ltr">(Read + Write)</span> من هذا المشروع
                وحده، وضعه في متغير التوكن الخادمي.
              </li>
              <li>لا تستخدم توكن المنتجات ولا توكن الطلبات هنا إطلاقاً.</li>
            </ol>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <SectionHeader
        title="الإشعارات"
        description="إشعارات داخلية تُنشأ هنا وتظهر للعملاء في شاشة الإشعارات. المسودة والمؤرشف لا يظهران للعملاء."
        onAdd={() => {
          setEditing(null)
          setFormOpen(true)
        }}
        addLabel="إشعار جديد"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث بعنوان الإشعار..."
      />

      {/* الإحصاءات */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="الإجمالي" value={stats.total} />
        <StatCard label={NOTIFICATION_STATUS_LABELS.published} value={stats.published} tone="published" />
        <StatCard label={NOTIFICATION_STATUS_LABELS.draft} value={stats.draft} tone="draft" />
        <StatCard label={NOTIFICATION_STATUS_LABELS.archived} value={stats.archived} tone="archived" />
      </div>

      {/* التصفية والترتيب */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["all", "published", "draft", "archived"] as StatusFilter[]).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={statusFilter === value ? "default" : "outline"}
            onClick={() => setStatusFilter(value)}
          >
            {value === "all" ? "الكل" : NOTIFICATION_STATUS_LABELS[value]}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ms-auto gap-1.5"
          onClick={() => setSort((s) => (s === "newest" ? "oldest" : "newest"))}
        >
          {sort === "newest" ? (
            <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ArrowUpWideNarrow className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {sort === "newest" ? "الأحدث أولاً" : "الأقدم أولاً"}
        </Button>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => router.refresh()}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          تحديث
        </Button>
      </div>

      {loadError ? (
        <Card className="mb-4 flex flex-col gap-3 border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm">{loadError}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => router.refresh()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      {visible.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <Bell className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">
            {notifications.length === 0 ? "لا توجد إشعارات بعد" : "لا نتائج مطابقة"}
          </p>
          <p className="text-sm text-muted-foreground">
            {notifications.length === 0
              ? "أنشئ إشعاراً جديداً واحفظه كمسودة أو انشره ليظهر للعملاء فوراً."
              : "جرّب تغيير كلمة البحث أو التصفية."}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((item) => (
            <Card
              key={item._id}
              className={cn("flex flex-col gap-3 p-4 sm:flex-row sm:items-start", isPending && "opacity-60")}
            >
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted">
                {item.imageUrl ? (
                  <Image src={item.imageUrl} alt="" fill className="object-cover" unoptimized />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">
                    <Bell className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold">{item.title}</p>
                  <Badge className={cn("border-0", STATUS_STYLES[item.status])}>
                    {NOTIFICATION_STATUS_LABELS[item.status]}
                  </Badge>
                  {item.priority === "important" ? (
                    <Badge className="border-0 bg-primary/15 text-primary">
                      {NOTIFICATION_PRIORITY_LABELS.important}
                    </Badge>
                  ) : null}
                </div>

                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.body}</p>

                {item.link ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-all font-mono" dir="ltr">
                      {item.link}
                    </span>
                  </p>
                ) : null}

                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div className="flex gap-1">
                    <dt>النشر:</dt>
                    <dd>{formatDateTime(item.publishedAt)}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>الانتهاء:</dt>
                    <dd>{item.expiresAt ? formatDateTime(item.expiresAt) : "بلا انتهاء"}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>آخر تعديل:</dt>
                    <dd>{formatDateTime(item.updatedAt)}</dd>
                  </div>
                  {item.createdBy ? (
                    <div className="flex gap-1">
                      <dt>بواسطة:</dt>
                      <dd>{item.createdBy}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="معاينة"
                  onClick={() => setPreviewing(item)}
                >
                  <Eye className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="تعديل"
                  onClick={() => {
                    setEditing(item)
                    setFormOpen(true)
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>

                {item.status === "published" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={isPending}
                    onClick={() => runAction(() => unpublishNotification(item._id))}
                  >
                    <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                    إلغاء النشر
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={isPending}
                    onClick={() => runAction(() => publishNotification(item._id))}
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    نشر الإشعار
                  </Button>
                )}

                {item.status !== "archived" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="أرشفة"
                    disabled={isPending}
                    onClick={() => runAction(() => archiveNotification(item._id))}
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                ) : null}

                <DeleteButton
                  onConfirm={() => runAction(() => deleteNotification(item._id))}
                  itemLabel={item.title}
                  disabled={isPending}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-4 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        الأرشفة تخفي الإشعار عن العملاء وتُبقيه هنا لإعادة نشره لاحقاً. الحذف يزيل مستند الإش��ار فقط
        ولا يحذف صورة مشتركة مع إشعار آخر. الإشعارات محفوظة في مشروع الإشعارات المستقل ولا تُخزَّن مع
        المنتجات أو الطلبات.
      </p>

      <NotificationFormDialog
        key={editing?._id ?? "new"}
        open={formOpen}
        onOpenChange={setFormOpen}
        notification={editing}
        onDone={() => router.refresh()}
      />

      <PreviewDialog notification={previewing} onClose={() => setPreviewing(null)} />
    </div>
  )
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: NotificationStatus
}) {
  return (
    <Card className="flex flex-col gap-1 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-2xl font-bold tabular-nums",
          tone === "published" && "text-emerald-600 dark:text-emerald-400",
          tone === "draft" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </span>
    </Card>
  )
}

/** نموذج إنشاء/تعديل الإشعار مع معاينة قبل النشر. */
function NotificationFormDialog({
  open,
  onOpenChange,
  notification,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  notification: AdminNotification | null
  onDone: () => void
}) {
  const [title, setTitle] = useState(notification?.title ?? "")
  const [body, setBody] = useState(notification?.body ?? "")
  const [link, setLink] = useState(notification?.link ?? "")
  const [priority, setPriority] = useState<NotificationPriority>(notification?.priority ?? "normal")
  const [publishedAt, setPublishedAt] = useState(toLocalInputValue(notification?.publishedAt ?? null))
  const [expiresAt, setExpiresAt] = useState(
    notification?.expiresAt ? toLocalInputValue(notification.expiresAt) : "",
  )
  const [showPreview, setShowPreview] = useState(false)
  const [isPending, startTransition] = useTransition()

  const linkValid = link.trim() === "" || sanitizeInternalLink(link) !== null

  /** يبني FormData ويرسله مع الحالة المطلوبة (مسودة أو نشر). */
  function submit(formEl: HTMLFormElement, status: NotificationStatus) {
    if (!linkValid) {
      toast.error("الرابط يجب أن يكون مساراً داخلياً يبدأ بـ /")
      return
    }

    const form = new FormData(formEl)
    form.set("title", title)
    form.set("body", body)
    form.set("link", link.trim())
    form.set("priority", priority)
    form.set("status", status)
    // نحوّل التوقيت المحلي إلى ISO على العميل، ويعيد الخادم التحقق منه.
    form.set(
      "publishedAt",
      publishedAt ? new Date(publishedAt).toISOString() : new Date().toISOString(),
    )
    if (expiresAt) form.set("expiresAt", new Date(expiresAt).toISOString())
    else form.delete("expiresAt")

    startTransition(async () => {
      const result = await saveNotification(notification?._id ?? null, form)
      if (result.ok) {
        toast.success(result.message)
        onOpenChange(false)
        onDone()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{notification ? "تعديل الإشعار" : "إشعار جديد"}</DialogTitle>
          <DialogDescription>
            يُحفظ الإشعار في مشروع الإشعارات المستقل. المسودة لا تظهر للعملاء، والنشر يجعله ظاهراً فوراً.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit(e.currentTarget, "published")
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="notification-title">
              عنوان الإشعار <span className="text-destructive">*</span>
            </Label>
            <Input
              id="notification-title"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, NOTIFICATION_LIMITS.titleMax))}
              placeholder="عروض نهاية الأسبوع"
              required
            />
            <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
              {title.length} / {NOTIFICATION_LIMITS.titleMax}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notification-body">
              نص الإشعار <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="notification-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, NOTIFICATION_LIMITS.bodyMax))}
              placeholder="خصومات تصل إلى 40% على الأقسام المختارة حتى نهاية الأسبوع."
              required
            />
            <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
              {body.length} / {NOTIFICATION_LIMITS.bodyMax}
            </span>
          </div>

          <ImageField name="image" label="صورة الإشعار (اختيارية)" current={notification?.imageUrl ?? undefined} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="notification-link">رابط داخلي (اختياري)</Label>
            <Input
              id="notification-link"
              value={link}
              onChange={(e) => setLink(e.target.value.slice(0, NOTIFICATION_LIMITS.linkMax))}
              placeholder="/offers"
              dir="ltr"
              className={cn("font-mono", !linkValid && "border-destructive")}
              aria-invalid={!linkValid}
            />
            <p className={cn("text-xs", linkValid ? "text-muted-foreground" : "text-destructive")}>
              {linkValid
                ? "مسار داخلي فقط مثل /offers أو /product/product-slug أو /categories/category-slug."
                : "رابط غير صالح. يجب أن يبدأ بـ / ولا يُسمح بالروابط الخارجية أو javascript:."}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="notification-publishedAt">وقت النشر</Label>
              <Input
                id="notification-publishedAt"
                type="datetime-local"
                value={publishedAt}
                onChange={(e) => setPublishedAt(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="notification-expiresAt">وقت الانتهاء (اختياري)</Label>
              <Input
                id="notification-expiresAt"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>الأولوية</Label>
            <div className="flex gap-2">
              {(["normal", "important"] as NotificationPriority[]).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={priority === value ? "default" : "outline"}
                  onClick={() => setPriority(value)}
                >
                  {NOTIFICATION_PRIORITY_LABELS[value]}
                </Button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={() => setShowPreview((v) => !v)}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {showPreview ? "إخفاء المعاينة" : "معاينة قبل النشر"}
          </Button>

          {showPreview ? (
            <div className="rounded-xl border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-bold text-muted-foreground">هكذا يظهر للعميل</p>
              <NotificationPreviewCard
                title={title || "عنوان الإشعار"}
                body={body || "نص الإشعار"}
                imageUrl={notification?.imageUrl ?? null}
                link={sanitizeInternalLink(link)}
                priority={priority}
              />
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              إلغاء
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="gap-1.5"
              disabled={isPending}
              onClick={(e) => {
                const form = e.currentTarget.closest("form")
                if (form?.reportValidity()) submit(form, "draft")
              }}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              حفظ كمسودة
            </Button>
            <Button type="submit" className="gap-1.5" disabled={isPending}>
              <Send className="h-4 w-4" aria-hidden="true" />
              {isPending ? "جارٍ الحفظ..." : "إرسال ونشر"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** بطاقة معاينة مطابقة لشكل الإشعار عند العميل. */
function NotificationPreviewCard({
  title,
  body,
  imageUrl,
  link,
  priority,
}: {
  title: string
  body: string
  imageUrl: string | null
  link: string | null
  priority: NotificationPriority
}) {
  return (
    <article className="overflow-hidden rounded-xl border bg-card">
      {imageUrl ? (
        <div className="relative aspect-[16/9] w-full bg-muted">
          <Image src={imageUrl} alt="" fill className="object-cover" unoptimized />
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5 p-3">
        <div className="flex items-center gap-2">
          <h3 className="font-bold leading-snug">{title}</h3>
          {priority === "important" ? (
            <Badge className="border-0 bg-primary/15 text-primary">مهم</Badge>
          ) : null}
        </div>
        <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{body}</p>
        {link ? (
          <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
            عرض التفاصيل
          </span>
        ) : null}
      </div>
    </article>
  )
}

/** معاينة إشعار محفوظ كما يراه العميل. */
function PreviewDialog({
  notification,
  onClose,
}: {
  notification: AdminNotification | null
  onClose: () => void
}) {
  return (
    <Dialog open={Boolean(notification)} onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>معاينة الإشعار</DialogTitle>
          <DialogDescription>هكذا يظهر الإشعار في شاشة الإشعارات للعميل.</DialogDescription>
        </DialogHeader>
        {notification ? (
          <>
            <NotificationPreviewCard
              title={notification.title}
              body={notification.body}
              imageUrl={notification.imageUrl}
              link={notification.link}
              priority={notification.priority}
            />
            {notification.status !== "published" ? (
              <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                الحالة الحالية «{NOTIFICATION_STATUS_LABELS[notification.status]}» — لا يظهر للعملاء
                حتى تنشره.
              </p>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
