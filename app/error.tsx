"use client"

import Link from "next/link"
import { AlertTriangle, RefreshCw } from "lucide-react"

// حدّ خطأ عام: أي فشل غير متوقع في صفحة يبقى محصوراً هنا مع زر إعادة المحاولة بدل صفحة بيضاء.
export default function GlobalRouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4 py-20 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden="true" />
      </span>
      <h1 className="text-lg font-bold">حدث خطأ غير متوقع</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">تعذّر عرض هذه الصفحة. جرّب مرة أخرى، وإن استمر الخطأ فعُد للرئيسية.</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={reset} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          إعادة المحاولة
        </button>
        <Link href="/" className="flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-bold">
          الرئيسية
        </Link>
      </div>
    </main>
  )
}
