import Link from "next/link"
import { SafeImage } from "@/components/safe-image"
import type { Brand } from "@/lib/types"

export function BrandCard({ brand }: { brand: Brand }) {
  return (
    <Link prefetch={false}
      href={`/brand/${brand.slug}`}
      className="group block overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-primary/40 hover:shadow-lg"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <SafeImage
          src={brand.image}
          alt={brand.name}
          fill
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/55 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-3">
          <h3 className="text-lg font-bold text-background drop-shadow">{brand.name}</h3>
          {typeof brand.productCount === "number" && (
            <span className="text-xs font-medium text-background/90">
              {brand.productCount} منتج
            </span>
          )}
        </div>
      </div>
      {brand.description && (
        <div className="p-3">
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground text-pretty">
            {brand.description}
          </p>
        </div>
      )}
    </Link>
  )
}
