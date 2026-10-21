"use client"

import Link from "next/link"
import { SafeImage } from "@/components/safe-image"
import { useCallback, useEffect, useState } from "react"
import useEmblaCarousel from "embla-carousel-react"
import type { Slide } from "@/lib/types"

export function HeroSlider({ slides }: { slides: Slide[] }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, direction: "rtl" })
  const [selectedIndex, setSelectedIndex] = useState(0)

  const onSelect = useCallback(() => {
    if (!emblaApi) return
    setSelectedIndex(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  useEffect(() => {
    if (!emblaApi) return
    onSelect()
    emblaApi.on("select", onSelect)
    const interval = setInterval(() => emblaApi.scrollNext(), 5000)
    return () => {
      clearInterval(interval)
      emblaApi.off("select", onSelect)
    }
  }, [emblaApi, onSelect])

  if (slides.length === 0) return null

  return (
    <section className="relative" aria-label="عروض المتجر">
      <div className="overflow-hidden rounded-3xl mx-4 mt-4" ref={emblaRef}>
        <div className="flex">
          {slides.map((slide, i) => (
            <Link
              key={slide.id}
              href={slide.href || "/categories"}
              className="flex-[0_0_100%] min-w-0 relative block"
              aria-label={slide.title}
            >
              <div className="relative aspect-[16/10] md:aspect-[21/9] bg-muted">
                <SafeImage
                  src={slide.image}
                  alt={slide.title}
                  fill
                  priority={i === 0}
                  className="object-cover"
                  sizes="100vw"
                />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {slides.length > 1 && (
        <div className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-2">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => emblaApi?.scrollTo(i)}
              aria-label={`الانتقال إلى الشريحة ${i + 1}`}
              aria-current={i === selectedIndex}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === selectedIndex ? "w-6 bg-primary" : "w-2 bg-background/70"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  )
}
