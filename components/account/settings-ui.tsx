import Link from "next/link"
import { ChevronLeft, Lock } from "lucide-react"
import type { LucideIcon } from "lucide-react"

/** مجموعة إعدادات: عنوان قصير وبطاقة صفوف متتالية. */
export function SettingsGroup({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6" aria-label={title}>
      <h2 className="mb-2 px-1 text-sm font-bold text-muted-foreground">{title}</h2>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <ul className="divide-y divide-border">{children}</ul>
      </div>
      {hint && <p className="mt-2 px-1 text-xs text-muted-foreground">{hint}</p>}
    </section>
  )
}

const rowCls = "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-right transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"

function RowBody({ icon: Icon, label, description, trailing, muted }: { icon: LucideIcon; label: string; description?: string; trailing?: React.ReactNode; muted?: boolean }) {
  return (
    <>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${muted ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-medium ${muted ? "text-muted-foreground" : ""}`}>{label}</span>
        {description && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>}
      </span>
      {trailing}
    </>
  )
}

/**
 * صف رابط. `locked` للميزات التي تتطلب حساباً: يظهر بقفل ويقود الزائر إلى تسجيل الدخول ثم يعود إلى وجهته.
 * `trailing` عنصر اختياري (عدّاد/قيمة) يسبق السهم.
 */
export function SettingsRow({
  href,
  icon,
  label,
  description,
  trailing,
  locked,
}: {
  href: string
  icon: LucideIcon
  label: string
  description?: string
  trailing?: React.ReactNode
  locked?: boolean
}) {
  if (locked) {
    return (
      <li>
        <Link href={`/login?next=${encodeURIComponent(href)}`} className={rowCls} aria-label={`${label} — يتطلب تسجيل الدخول`}>
          <RowBody icon={icon} label={label} description="يتطلب تسجيل الدخول" muted trailing={<Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />} />
        </Link>
      </li>
    )
  }
  return (
    <li>
      <Link href={href} className={rowCls}>
        <RowBody
          icon={icon}
          label={label}
          description={description}
          trailing={
            <>
              {trailing}
              <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </>
          }
        />
      </Link>
    </li>
  )
}

/** صف زر (فتح نافذة، مشاركة...). */
export function SettingsButtonRow({ icon, label, description, trailing, onClick }: { icon: LucideIcon; label: string; description?: string; trailing?: React.ReactNode; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className={rowCls}>
        <RowBody icon={icon} label={label} description={description} trailing={trailing} />
      </button>
    </li>
  )
}

export function CountPill({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold tabular-nums text-primary">{children}</span>
}
