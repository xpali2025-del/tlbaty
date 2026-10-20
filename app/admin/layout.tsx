import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return (
    <div className="mx-auto max-w-5xl p-4">
      <nav className="mb-6 flex gap-4 border-b pb-3">
        <Link href="/admin">المنتجات</Link>
        <Link href="/admin/categories">التصنيفات</Link>
        <Link href="/admin/orders">الطلبات</Link>
      </nav>
      {children}
    </div>
  )
}
