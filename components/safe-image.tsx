"use client"

import Image, { type ImageProps } from "next/image"
import { useState } from "react"

/**
 * مسار صورة الاحتياط المحلية — لا تُخزَّن في قاعدة البيانات ولا تتطلب أي طلب API إضافي
 */
export const PLACEHOLDER_IMAGE = "/images/product-placeholder.webp"

type SafeImageProps = Omit<ImageProps, "src" | "onError"> & {
  /** رابط الصورة — يقبل null/undefined/سلسلة فارغة بأمان */
  src?: string | null
}

/**
 * مكوّن صور موحّد مع نظام احتياط عالمي:
 *
 * 1. أثناء الـ SSR: إن كان المصدر مفقوداً (null/فارغ) تُعرض صورة الاحتياط المحلية فوراً
 *    — دون وميض ودون انزياح تخطيط (نفس الأبعاد دائماً).
 * 2. على العميل: إن فشل تحميل الصورة (محذوفة من قاعدة البيانات، رابط مكسور…)
 *    يستبدلها onError فوراً بصورة الاحتياط المحلية — صفر طلبات إضافية إلى قاعدة البيانات.
 * 3. إن فشلت صورة الاحتياط نفسها: تُعرض لوحة علامة تجارية بسيطة
 *    (شعار المتجر + "الصورة غير متوفرة") بنفس أبعاد الحاوية.
 */
export function SafeImage({ src, alt, className, ...props }: SafeImageProps) {
  // 0 = المصدر الأصلي | 1 = صورة الاحتياط المحلية | 2 = لوحة العلامة التجارية
  const [failLevel, setFailLevel] = useState(0)

  const hasValidSrc = typeof src === "string" && src.trim().length > 0
  const resolvedSrc = failLevel === 0 && hasValidSrc ? src : PLACEHOLDER_IMAGE

  // المستوى الأخير: حتى صورة الاحتياط المحلية غير متاحة
  if (failLevel >= 2) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex h-full w-full flex-col items-center justify-center gap-2 bg-secondary text-muted-foreground ${
          props.fill ? "absolute inset-0" : ""
        }`}
      >
        {/* شعار المتجر كصورة أصلية خفيفة — إن فشل يُخفى ويبقى النص */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-192.webp"
          alt=""
          aria-hidden="true"
          className="h-8 w-auto opacity-60"
          onError={(e) => {
            e.currentTarget.style.display = "none"
          }}
        />
        <span className="text-xs font-medium">الصورة غير متوفرة</span>
      </div>
    )
  }

  return (
    <Image
      {...props}
      src={resolvedSrc || PLACEHOLDER_IMAGE}
      alt={alt}
      className={className}
      onError={() => {
        // إن كنا نعرض المصدر الأصلي انتقل للاحتياط المحلي، وإلا فاللوحة النهائية
        setFailLevel((lvl) => (lvl === 0 && hasValidSrc ? 1 : 2))
      }}
    />
  )
}
