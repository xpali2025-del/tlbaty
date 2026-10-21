import type { Metadata } from "next"
import { Suspense } from "react"
import { Bell, Loader2 } from "lucide-react"

import { Header } from "@/components/header"
import { FooterClient } from "@/components/footer-client"
import { MobileNav } from "@/components/mobile-nav"
import { NotificationsClient } from "@/components/notifications-client"
import { getPublicNotifications } from "@/lib/notifications"

// ============================================
// شاشة الإشعارات — /notifications
//
// حالة القراءة محلية لكل جهاز، فلا معنى لفهرسة الصفحة.
// ============================================

export const metadata: Metadata = {
  title: "الإشعارات",
  description: "آخر الإشعارات والأخبار والعروض من المتجر.",
  robots: { index: false, follow: true },
}

/** هيكل تحميل بسيط أثناء جلب الإشعارات من الخادم. */
function NotificationsLoading() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      <p className="text-sm">جارٍ تحميل الإشعارات...</p>
    </div>
  )
}

/**
 * جلب البيانات داخل مكوّن منفصل حتى يبقى الهيدر والفوتر ظاهرين
 * أثناء التحميل، ويتعامل error.tsx مع فشل مشروع الإشعارات.
 */
async function NotificationsFeed() {
  const { items, total, hasMore } = await getPublicNotifications(0)

  return <NotificationsClient initialItems={items} initialHasMore={hasMore} total={total} />
}

export default function NotificationsPage() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-6 pb-24 lg:pb-12">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Bell className="h-5 w-5 text-primary" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold md:text-3xl">الإشعارات</h1>
        </div>

        <Suspense fallback={<NotificationsLoading />}>
          <NotificationsFeed />
        </Suspense>
      </main>
      <FooterClient />
      <MobileNav />
    </>
  )
}
