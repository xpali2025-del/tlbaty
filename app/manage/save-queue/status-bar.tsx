"use client"

import { AlertTriangle, Loader2, WifiOff } from "lucide-react"
import { useSaveJobs } from "./queue"

/** شريط حالة الحفظ في رأس اللوحة: «جارٍ حفظ 2…» أو «فشل حفظ 1 — عرض». لا يظهر إن لم يكن هناك شيء. */
export function SaveStatusBar({ onShowProblems }: { onShowProblems: (screen: string) => void }) {
  const jobs = useSaveJobs()
  const problems = jobs.filter((j) => (j.state === "failed" && !j.offline) || j.state === "conflict")
  const waiting = jobs.filter((j) => j.state === "retrying" || (j.state === "failed" && j.offline))
  const working = jobs.filter((j) => j.state === "queued" || j.state === "running")
  if (working.length + waiting.length + problems.length === 0) return null

  return (
    <div data-testid="save-status" role="status" aria-live="polite" className="sticky top-0 z-30 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-card px-3 py-2 text-sm shadow-sm">
      {working.length > 0 && (
        <span className="flex items-center gap-1.5 text-muted-foreground" data-testid="save-status-working">
          <Loader2 className="h-4 w-4 animate-spin" /> جارٍ حفظ {working.length}…
        </span>
      )}
      {waiting.length > 0 && (
        <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400" data-testid="save-status-waiting">
          <WifiOff className="h-4 w-4" /> انقطع الاتصال، {waiting.length} بانتظار الإرسال (لن يضيع شيء)
        </span>
      )}
      {problems.length > 0 && (
        <button type="button" onClick={() => onShowProblems(problems[0].screen)} className="flex items-center gap-1.5 font-medium text-destructive underline-offset-2 hover:underline" data-testid="save-status-problems">
          <AlertTriangle className="h-4 w-4" /> فشل حفظ {problems.length} — عرض
        </button>
      )}
    </div>
  )
}
