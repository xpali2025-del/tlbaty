import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowRight } from "lucide-react"
import { hasManagePermission } from "@/lib/manage-auth"
import { getAdminNotifications } from "@/lib/admin-notifications"
import { NotificationsManager } from "../components/notifications-manager"

export const metadata: Metadata = {
  title: "الإشعارات",
  robots: { index: false, follow: false },
}

// صفحة مستقلة لإدارة الإشعارات، إضافة إلى تبويب «الإشعارات» داخل اللوحة.
// التحقق من الجلسة يتم هنا وأيضاً داخل كل Server Action (وليس على مستوى الواجهة فقط).
export default async function ManageNotificationsPage() {
  if (!(await hasManagePermission("notifications"))) {
    redirect("/manage/login")
  }

  const data = await getAdminNotifications()

  return (
    <main className="mx-auto max-w-[1100px] p-4 lg:p-6">
      <Link
        href="/manage"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
        رجوع إلى لوحة الإدارة
      </Link>
      <NotificationsManager data={data} />
    </main>
  )
}
