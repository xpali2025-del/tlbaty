import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { SafeImage } from "@/components/safe-image"
import type { Category } from "@/lib/types"

export function CategoryList({ categories }: { categories: Category[] }) {
  if (categories.length === 0) return null
  return (
    <section id="categories" className="bg-secondary/35 py-10 md:py-14" aria-label="الأقسام">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-6 text-center">
          <span className="text-xs font-bold tracking-wide text-primary">تصفّحي بسهولة</span>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground md:text-3xl">الأقسام</h2>
        </div>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          {categories.map((cat) => (
            <li key={cat.id}>
              <Link prefetch={false}
                href={`/category/${cat.slug}`}
                className="group flex items-center gap-4 rounded-2xl border border-border/70 bg-card p-3 shadow-[0_12px_35px_-30px_rgba(57,24,33,0.55)] transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_18px_40px_-26px_rgba(57,24,33,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="relative size-20 shrink-0 overflow-hidden rounded-2xl bg-secondary">
                  <SafeImage src={cat.image} alt={cat.name} fill sizes="64px" className="object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-foreground">{cat.name}</h3>
                  <p className="text-xs text-muted-foreground">اكتشفي الآن</p>
                </div>
                <ArrowLeft className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
