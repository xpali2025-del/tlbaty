"use client"

import { AlertTriangle, Check, Loader2, RotateCcw, WifiOff, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { SaveJob } from "./core"
import { setInstantSave, useInstantSave } from "./instant-save"
import { discardJob, getSaveQueue } from "./queue"

// واجهة الحفظ الفوري المشتركة بين الشاشات: شارة الحالة على العنصر، تفاصيل المشكلة، ومفتاح الرجوع.

/** شارة حالة الحفظ على عنصر القائمة. */
export function SaveBadge({ job }: { job: SaveJob }) {
  const base = { "data-testid": "save-badge", "data-state": job.state } as const
  if (job.state === "queued" || job.state === "running") {
    return (
      <Badge variant="outline" className="gap-1" {...base}>
        <Loader2 className="h-3 w-3 animate-spin" /> جارٍ الحفظ…
      </Badge>
    )
  }
  if (job.state === "saved") {
    return (
      <Badge variant="outline" className="gap-1 border-green-600 text-green-700 dark:text-green-400" {...base}>
        <Check className="h-3 w-3" /> تم الحفظ
      </Badge>
    )
  }
  if (job.state === "retrying" || (job.state === "failed" && job.offline)) {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700 dark:text-amber-400" {...base}>
        <WifiOff className="h-3 w-3" /> بانتظار الاتصال
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" className="gap-1" {...base}>
      <AlertTriangle className="h-3 w-3" /> {job.state === "conflict" ? "تعارض" : "فشل الحفظ"}
    </Badge>
  )
}

/** تفاصيل ما يحتاج المدير: سبب الفشل مع «أعد المحاولة» و«تجاهل»، أو خيارا التعارض. التعديل من زر القلم. */
export function SaveProblem({ job, onKeepMine, onTakeTheirs }: { job: SaveJob; onKeepMine?: () => void; onTakeTheirs?: () => void }) {
  if (job.state === "conflict") {
    return (
      <div className="flex w-full flex-wrap items-center gap-2 border-t pt-2 text-sm" data-testid="save-problem">
        <p className="flex-1 text-destructive">عدّل شخص آخر هذا العنصر بعد فتحك للنموذج. اختر ما تريد:</p>
        {job.conflict && onKeepMine ? (
          <Button type="button" size="sm" variant="outline" onClick={onKeepMine}>
            احتفظ بتعديلي
          </Button>
        ) : null}
        {onTakeTheirs ? (
          <Button type="button" size="sm" variant="outline" onClick={onTakeTheirs}>
            {job.conflict ? "خذ النسخة الجديدة" : "تجاهل تعديلي"}
          </Button>
        ) : null}
      </div>
    )
  }
  if (job.state === "failed") {
    return (
      <div className="flex w-full flex-wrap items-center gap-2 border-t pt-2 text-sm" data-testid="save-problem">
        <p className="flex-1 text-destructive">{job.offline ? "تعذّر الاتصال بالخادم، وحفظك محفوظ في هذا المتصفح." : job.error}</p>
        <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => getSaveQueue().retry(job.id)}>
          <RotateCcw className="h-3.5 w-3.5" /> أعد المحاولة
        </Button>
        <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => discardJob(job)}>
          <X className="h-3.5 w-3.5" /> تجاهل
        </Button>
      </div>
    )
  }
  return null
}

/** مفتاح الرجوع: الحفظ الفوري مفعّل افتراضياً؛ إيقافه يعيد الانتظار ثم الإغلاق (لكل متصفح). */
export function InstantSaveToggle() {
  const instant = useInstantSave()
  return (
    <label className="mb-3 flex w-fit items-center gap-2 text-xs text-muted-foreground">
      <Switch checked={instant} onCheckedChange={setInstantSave} data-testid="instant-save-toggle" />
      الحفظ الفوري: تُغلق النافذة عند الضغط ويُكمل الحفظ في الخلفية
    </label>
  )
}
