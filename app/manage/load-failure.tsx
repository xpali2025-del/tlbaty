import { AlertTriangle } from "lucide-react"
import type { DbErrorKind } from "@/lib/db-error"

// شاشة تشخيص للمدير عند فشل تحميل بيانات اللوحة (بدل صفحة بيضاء). لا تظهر إلا بعد تسجيل الدخول.
export function LoadFailure({ hint, kind, digest }: { hint: string; kind: DbErrorKind; digest: string | null }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden="true" />
      </span>
      <h1 className="text-lg font-bold">تعذّر تحميل بيانات لوحة الإدارة</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p>
      <p className="text-xs text-muted-foreground" dir="ltr">
        {kind}
        {digest ? ` · digest: ${digest}` : ""}
      </p>
      <a href="/manage" className="mt-2 flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">
        إعادة المحاولة
      </a>
    </main>
  )
}
