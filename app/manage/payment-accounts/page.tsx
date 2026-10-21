import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowRight } from "lucide-react"
import { hasManagePermission } from "@/lib/manage-auth"
import { getAdminPaymentAccounts } from "@/lib/admin"
import { PaymentAccountsManager } from "../components/payment-accounts-manager"

export const metadata: Metadata = {
  title: "حسابات الدفع",
  robots: { index: false, follow: false },
}

// صفحة مستقلة لإدارة حسابات الدفع، إضافة إلى تبويب «حسابات الدفع» داخل اللوحة.
// التحقق من الجلسة يتم هنا وأيضاً داخل كل Server Action (وليس على مستوى الواجهة فقط).
export default async function ManagePaymentAccountsPage() {
  if (!(await hasManagePermission("payment-accounts"))) {
    redirect("/manage/login")
  }

  const accounts = await getAdminPaymentAccounts()

  return (
    <main className="mx-auto max-w-[1100px] p-4 lg:p-6">
      <Link
        href="/manage"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
        رجوع إلى لوحة الإدارة
      </Link>
      <PaymentAccountsManager accounts={accounts} />
    </main>
  )
}
