// يمنع ظهور هيكل المتجر (app/loading.tsx) داخل لوحة الإدارة أثناء التنقل.
export default function ManageLoading() {
  return (
    <div className="mx-auto max-w-[1400px] p-6" aria-busy="true">
      <span className="sr-only">جاري التحميل…</span>
      <div className="h-7 w-48 animate-pulse rounded-lg bg-muted" />
      <div className="mt-6 h-64 animate-pulse rounded-2xl bg-muted/60" />
    </div>
  )
}
