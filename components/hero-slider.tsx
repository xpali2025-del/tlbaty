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
    // لا تدوير تلقائي لمن فعّل «تقليل الحركة» ولا والتبويب مخفي (يوفر بطارية وCPU على الجوال).
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const interval = reduceMotion ? null : setInterval(() => {
      if (document.visibilityState === "visible") emblaApi.scrollNext()
    }, 5000)
    return () => {
      if (interval) clearInterval(interval)
      emblaApi.off("select", onSelect)
    }
  }, [emblaApi, onSelect])

  if (slides.length === 0) return null

  return (
    <section className="relative mx-auto max-w-7xl px-3 pt-3 sm:px-4 sm:pt-5" aria-label="عروض المتجر">
      <div
        className="overflow-hidden rounded-[1.75rem] border border-border/60 bg-muted shadow-[0_22px_60px_-36px_rgba(57,24,33,0.45)] sm:rounded-[2rem]"
        ref={emblaRef}
      >
        <div className="flex">
          {slides.map((slide, i) => (
            <Link
              key={slide.id}
              href={slide.href || "/categories"}
              className="relative block min-w-0 flex-[0_0_100%] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
              aria-label={slide.title}
            >
              <div className="relative aspect-[16/10] bg-muted sm:aspect-[16/8] lg:aspect-[21/8]">
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
        <div className="pointer-events-none absolute bottom-1 inset-x-0 flex items-center justify-center">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => emblaApi?.scrollTo(i)}
              aria-label={`الانتقال إلى الشريحة ${i + 1}`}
              aria-current={i === selectedIndex}
              className="pointer-events-auto flex h-11 min-w-6 items-center justify-center px-2"
            >
              <span
                aria-hidden="true"
                className={`block h-2 rounded-full transition-all duration-300 ${
                  i === selectedIndex ? "w-6 bg-primary" : "w-2 bg-background/70"
                }`}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
