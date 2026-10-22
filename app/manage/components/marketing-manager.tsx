"use client"

import { useState, useTransition } from "react"
import { BellRing, Play } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { AdminMarketing } from "@/lib/admin-marketing"
import { PLACEHOLDERS, REMINDER_KIND_LABELS, describeDiscount, renderReminderText, validateRule, type ReminderKind, type ReminderRule } from "@/lib/marketing/rules"
import { runRemindersNow, saveReminderRule } from "../marketing-actions"
import { SectionHeader } from "./shared"

// التذكيرات التلقائية داخل الموقع: سلة متروكة ورغبات. تصل كإشعار شخصي في جرس العميل مع كود خصم فريد له،
// ولا تُرسل إلا لمن فعّل «أوافق على استلام العروض». تعمل مرة يومياً، ويمكن تشغيلها الآن للتجربة.

const HOURS_PER_DAY = 24

export function MarketingManager({ initial }: { initial: AdminMarketing }) {
  const [data, setData] = useState(initial)
  const [pending, startTransition] = useTransition()
  const { stats } = data

  const runNow = () =>
    startTransition(async () => {
      const r = await runRemindersNow()
      if (!r.ok) return void toast.error(r.error)
      toast.success(r.message)
      setData(r.data.marketing)
    })

  return (
    <div className="space-y-6">
      <SectionHeader title="التذكيرات والعروض" description="تذكير تلقائي داخل الموقع بالسلة المتروكة والرغبات، مع كود خصم خاص بكل عميل." />

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "عملاء وافقوا على العروض", value: stats.optedIn },
            { label: "تذكير السلة (آخر 7 أيام)", value: stats.sentLast7Days.cart },
            { label: "تذكير الرغبات (آخر 7 أيام)", value: stats.sentLast7Days.wishlist },
            { label: "أكواد التذكير المستعملة", value: `${stats.couponsUsed} من ${stats.couponsIssued}` },
          ].map((c) => (
            <div key={c.label}>
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{c.value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            تُرسل فقط لمن فعّل «أوافق على استلام العروض» في حسابه، وتظهر في جرس الإشعارات داخل الموقع (لا واتساب). تعمل تلقائياً مرة يومياً.
            لا يُذكَّر عميل بسلة اشترى بعدها، ولا بمنتج نفد، ولا قبل مرور فاصل الانتظار.
          </p>
          <Button variant="outline" size="sm" onClick={runNow} disabled={pending}>
            <Play className="me-1 size-4" aria-hidden /> تشغيل الآن
          </Button>
        </div>
      </Card>

      {(["cart", "wishlist"] as const).map((kind) => (
        <RuleCard key={kind} rule={data.rules[kind]} onSaved={(rule) => setData((d) => ({ ...d, rules: { ...d.rules, [kind]: rule } }))} />
      ))}
    </div>
  )
}

function RuleCard({ rule, onSaved }: { rule: ReminderRule; onSaved: (rule: ReminderRule) => void }) {
  const kind: ReminderKind = rule.kind
  const [draft, setDraft] = useState(rule)
  const [unit, setUnit] = useState<"hours" | "days">(rule.delayHours % HOURS_PER_DAY === 0 ? "days" : "hours")
  const [pending, startTransition] = useTransition()
  const set = <K extends keyof ReminderRule>(key: K, value: ReminderRule[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const delayValue = unit === "days" ? draft.delayHours / HOURS_PER_DAY : draft.delayHours
  const problem = validateRule(draft)
  const preview = renderReminderText(draft.body, {
    product: kind === "cart" ? "قميص صيفي" : "فستان سهرة",
    code: "TJ8K2M9QX",
    discount: describeDiscount(draft),
    days: draft.couponValidDays,
  })

  const save = () =>
    startTransition(async () => {
      const r = await saveReminderRule(draft)
      if (!r.ok) return void toast.error(r.error)
      toast.success(r.message)
      onSaved(draft)
    })

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-bold">
          <BellRing className="size-4 text-primary" aria-hidden /> {REMINDER_KIND_LABELS[kind]}
        </h3>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          مفعّل
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-delay`}>{kind === "cart" ? "أرسل بعد ترك السلة" : "أرسل بعد إضافة الرغبة"}</Label>
          <div className="flex gap-2">
            <Input
              id={`${kind}-delay`}
              type="number"
              min={1}
              value={delayValue}
              dir="ltr"
              onChange={(e) => set("delayHours", Math.round(Number(e.target.value) * (unit === "days" ? HOURS_PER_DAY : 1)))}
              className="w-28"
            />
            <select value={unit} onChange={(e) => setUnit(e.target.value as "hours" | "days")} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="وحدة المدة">
              <option value="hours">ساعة</option>
              <option value="days">يوم</option>
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-cooldown`}>أقل فاصل بين تذكيرين لنفس العميل (أيام)</Label>
          <Input id={`${kind}-cooldown`} type="number" min={1} value={draft.cooldownDays} dir="ltr" onChange={(e) => set("cooldownDays", Math.round(Number(e.target.value)))} className="w-28" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${kind}-title`}>عنوان الإشعار</Label>
        <Input id={`${kind}-title`} value={draft.title} onChange={(e) => set("title", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${kind}-body`}>نص الإشعار</Label>
        <Textarea id={`${kind}-body`} value={draft.body} rows={3} onChange={(e) => set("body", e.target.value)} />
        <p className="text-xs text-muted-foreground">
          المتغيرات المتاحة:{" "}
          {PLACEHOLDERS.map((p) => (
            <button key={p} type="button" className="me-1 rounded bg-muted px-1.5 py-0.5 font-mono" onClick={() => set("body", `${draft.body} ${p}`)}>
              {p}
            </button>
          ))}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-dtype`}>نوع الخصم</Label>
          <select id={`${kind}-dtype`} value={draft.discountType} onChange={(e) => set("discountType", e.target.value as "percent" | "fixed")} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
            <option value="percent">نسبة %</option>
            <option value="fixed">مبلغ ثابت</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-dvalue`}>قيمة الخصم (0 = بلا كود)</Label>
          <Input id={`${kind}-dvalue`} type="number" min={0} value={draft.discountValue} dir="ltr" onChange={(e) => set("discountValue", Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-min`}>حد أدنى للطلب</Label>
          <Input id={`${kind}-min`} type="number" min={0} value={draft.minOrder} dir="ltr" onChange={(e) => set("minOrder", Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-valid`}>صلاحية الكود (أيام)</Label>
          <Input id={`${kind}-valid`} type="number" min={1} value={draft.couponValidDays} dir="ltr" onChange={(e) => set("couponValidDays", Math.round(Number(e.target.value)))} />
        </div>
      </div>

      <div className="rounded-lg bg-muted/50 p-3 text-sm">
        <p className="text-xs text-muted-foreground">معاينة ما يراه العميل</p>
        <p className="mt-1 font-bold">{renderReminderText(draft.title, { product: "", code: "", discount: "", days: 0 })}</p>
        <p className="mt-0.5 leading-relaxed">{preview}</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-destructive" role="status">{problem}</p>
        <Button onClick={save} disabled={pending || problem !== null}>
          حفظ
        </Button>
      </div>
    </Card>
  )
}
