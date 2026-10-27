"use client"

import Link from "next/link"
import { Bell } from "lucide-react"

import { useNotifications } from "@/components/notifications-provider"

// ============================================
// أيقونة الجرس في الهيدر
//
// - تفتح /notifications عند الضغط.
// - Badge بعدد غير المقروء: من 1 إلى 99، ثم "99+".
// - لا Badge عندما يكون العدد صفراً أو قبل قراءة التخزين المحلي،
//   فيتطابق HTML الخادم مع المتصفح (بلا Hydration Error).
// ============================================

export function NotificationsBell({ className = "" }: { className?: string }) {
  const { unreadCount, hydrated } = useNotifications()

  const showBadge = hydrated && unreadCount > 0
  const badgeText = unreadCount > 99 ? "99+" : String(unreadCount)

  return (
    <Link
      href="/notifications"
      aria-label="الإشعارات"
      className={`relative p-2 text-foreground transition-colors hover:text-primary ${className}`}
    >
      <Bell className="h-6 w-6" />
      {showBadge && (
        <span
          className={`absolute top-0 left-0 flex h-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground ${
            // "99+" أعرض من رقم واحد، فنوسّع الحاوية بدل قصّ النص.
            unreadCount > 99 ? "min-w-[26px] px-1" : "w-5"
          }`}
        >
          {badgeText}
        </span>
      )}
      {/* وصف مقروء لقارئات الشاشة يتحدث مع العدد */}
      <span className="sr-only">
        {showBadge ? `${unreadCount} إشعار غير مقروء` : "لا توجد إشعارات غير مقروءة"}
      </span>
    </Link>
  )
}
