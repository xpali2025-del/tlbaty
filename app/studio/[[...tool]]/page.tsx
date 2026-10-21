"use client"

import { NextStudio } from "next-sanity/studio"
import config from "@/sanity.config"
import { isSanityConfigured } from "@/sanity/env"

export default function StudioPage() {
  // بدون بيانات الاعتماد يظهر إرشاد الإعداد بدلاً من شاشة خطأ
  if (!isSanityConfigured) {
    return (
      <main dir="rtl" className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-lg border border-border bg-card p-8 text-card-foreground">
          <h1 className="mb-4 text-xl font-bold text-balance">استوديو Sanity غير مهيّأ بعد</h1>
          <p className="mb-4 leading-relaxed text-muted-foreground">
            أضف متغيرات البيئة التالية ثم أعد تشغيل المشروع لفتح الاستوديو:
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-4 text-start font-mono text-sm leading-relaxed" dir="ltr">
            {`NEXT_PUBLIC_SANITY_PROJECT_ID=YOUR_PROJECT_ID
NEXT_PUBLIC_SANITY_DATASET=production
NEXT_PUBLIC_SANITY_API_VERSION=2026-01-01
NEXT_PUBLIC_SANITY_USE_CDN=false`}
          </pre>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            {
              "أضفها إلى Vars في v0 أو Environment Variables في Vercel ثم أنشئ Deployment جديداً. توكن API غير مطلوب لفتح الاستوديو — راجع ملف .env.example."
            }
          </p>
        </div>
      </main>
    )
  }

  return <NextStudio config={config} />
}
