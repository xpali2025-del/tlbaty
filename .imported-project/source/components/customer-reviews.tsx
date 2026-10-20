import { Star, Quote } from "lucide-react"
import { SafeImage } from "@/components/safe-image"
import type { Review } from "@/lib/types"

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
}

export function CustomerReviews({ reviews }: { reviews: Review[] }) {
  if (!reviews.length) return null
  return (
    <section className="py-10 bg-accent/40" aria-label="آراء العملاء">
      <div className="mx-auto max-w-7xl px-4">
        <div className="text-center mb-6">
          <h2 className="text-xl md:text-2xl font-bold text-foreground">آراء عملائنا</h2>
          <p className="text-sm text-muted-foreground mt-1">ماذا قال عنا عملاؤنا الكرام</p>
        </div>

        <ul className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 snap-x snap-mandatory">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="snap-start shrink-0 w-[85%] sm:w-[360px] bg-card border border-border rounded-3xl p-5 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="relative w-12 h-12 rounded-full overflow-hidden bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0">
                    {review.avatar ? (
                      <SafeImage src={review.avatar} alt={review.name} fill className="object-cover" sizes="48px" />
                    ) : (
                      <span aria-hidden="true">{initials(review.name)}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-foreground text-sm">{review.name}</h3>
                    <div
                      className="flex items-center gap-0.5"
                      aria-label={`التقييم ${review.rating} من 5`}
                    >
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3.5 h-3.5 ${
                            i < review.rating
                              ? "fill-amber-400 text-amber-400"
                              : "fill-muted text-muted"
                          }`}
                          aria-hidden="true"
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <Quote className="w-6 h-6 text-primary/30 shrink-0" aria-hidden="true" />
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground line-clamp-4">
                {review.comment}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
