import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { SafeImage } from "@/components/safe-image"
import type { Category } from "@/lib/types"

export function CategoryList({ categories }: { categories: Category[] }) {
  if (categories.length === 0) return null
  return (
    <section id="categories" className="py-8" aria-label="الأقسام">
      <div className="mx-auto max-w-7xl px-4">
        <h2 className="text-xl md:text-2xl font-bold text-foreground mb-5 text-center">الأقسام</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {categories.map((cat) => (
            <li key={cat.id}>
              <Link
                href={`/category/${cat.slug}`}
                className="flex items-center gap-4 bg-card border border-border rounded-2xl p-3 hover:border-primary/40 hover:shadow-sm transition-all"
              >
                <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-secondary shrink-0">
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
