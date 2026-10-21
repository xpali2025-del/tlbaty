import Link from "next/link"
import { SafeImage } from "@/components/safe-image"
import type { Ad } from "@/lib/types"

/**
 * إعلان يظهر بين المنتجات. يمتد على كامل عرض الشبكة (col-span-full)
 * بحجم بانر مناسب. يلتفّ برابط فقط عند وجود href.
 */
export function AdBanner({ ad }: { ad: Ad }) {
  const media = (
    <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-secondary shadow-sm">
      <span className="absolute right-3 top-3 z-10 rounded-full bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur">
        إعلان
      </span>
      <div className="relative aspect-[851/315] w-full">
        <SafeImage
          src={ad.image}
          alt={ad.title}
          fill
          sizes="100vw"
          className="object-cover"
        />
      </div>
    </div>
  )

  if (ad.href) {
    return (
      <Link
        href={ad.href}
        aria-label={ad.title}
        className="col-span-full block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl"
      >
        {media}
      </Link>
    )
  }

  return (
    <div className="col-span-full" role="complementary" aria-label={ad.title}>
      {media}
    </div>
  )
}

/**
 * يدمج الإعلانات بين المنتجات: بعد كل (frequency) منتج يظهر إعلان.
 * عند وجود أكثر من إعلان يتم التناوب بينها. لا يُضاف إعلان في النهاية
 * إذا لم يتبقَّ منتجات بعده. إن لم توجد إعلانات تُعرض المنتجات كما هي.
 */
export function interleaveAds<T>(
  items: T[],
  ads: Ad[],
): Array<{ type: "item"; value: T } | { type: "ad"; value: Ad }> {
  const result: Array<{ type: "item"; value: T } | { type: "ad"; value: Ad }> = []
  if (ads.length === 0 || items.length === 0) {
    return items.map((value) => ({ type: "item" as const, value }))
  }

  const step = Math.max(1, ads[0].frequency ?? 6)
  let adIndex = 0

  items.forEach((value, i) => {
    result.push({ type: "item", value })
    const isSlot = (i + 1) % step === 0
    const hasMoreItems = i < items.length - 1
    if (isSlot && hasMoreItems) {
      result.push({ type: "ad", value: ads[adIndex % ads.length] })
      adIndex += 1
    }
  })

  return result
}
