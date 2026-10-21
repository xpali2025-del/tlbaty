"use client"

import Link from "next/link"
import Image from "next/image"
import { useSiteConfig } from "@/components/site-config-provider"

/** شعار المتجر: المرفوع من لوحة الإدارة، وإلا الشعار الافتراضي. الاسم يأتي من الإعدادات أيضاً. */
export function Logo({ className = "" }: { className?: string }) {
  const { name, logoUrl } = useSiteConfig()
  return (
    <Link href="/" className={`inline-flex items-center ${className}`} aria-label={`${name} - الرئيسية`}>
      <Image
        src={logoUrl ?? "/logo.png"}
        alt={name}
        width={200}
        height={100}
        priority
        unoptimized={Boolean(logoUrl)}
        className="h-auto w-auto max-h-12"
      />
    </Link>
  )
}
