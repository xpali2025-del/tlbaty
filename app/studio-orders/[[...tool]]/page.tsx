"use client"

import { NextStudio } from "next-sanity/studio"
import config from "@/sanity.orders.config"
import { isOrdersStudioConfigured } from "@/sanity/orders/env"

export default function OrdersStudioPage() {
  // بدون معرّف مشروع الطلبات يظهر إرشاد الإعداد بدلاً من شاشة خطأ
  if (!isOrdersStudioConfigured) {
    return (
      <main dir="rtl" className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-lg border border-border bg-card p-8 text-card-foreground">
          <h1 className="mb-4 text-xl font-bold text-balance">استوديو الطلبات غير مهيّأ بعد</h1>
          <p className="mb-4 leading-relaxed text-muted-foreground">
            أضف متغيرات البيئة التالية ثم أعد تشغيل المشروع لفتح استوديو الطلبات:
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-4 text-start font-mono text-sm leading-relaxed" dir="ltr">
            {`NEXT_PUBLIC_SANITY_ORDERS_PROJECT_ID=YOUR_ORDERS_PROJECT_ID
NEXT_PUBLIC_SANITY_ORDERS_DATASET=production
NEXT_PUBLIC_SANITY_ORDERS_API_VERSION=2026-01-01`}
          </pre>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            {
              "توكن الطلبات مطلوب لحفظ الطلبات عبر الخادم، لكنه غير مطلوب لفتح الاستوديو. أضف المتغيرات إلى Vars ثم أنشئ Deployment جديداً — راجع ملف .env.example."
            }
          </p>
        </div>
      </main>
    )
  }

  return <NextStudio config={config} />
}
