import Link from 'next/link'
import { signout } from '@/app/actions/auth'
import { isAdminEmail } from '@/lib/admin-email'
import { readCart } from '@/lib/cart'
import { getOptionalAuthUser } from '@/lib/supabase/server'

export async function SiteHeader() {
  const [user, cart] = await Promise.all([getOptionalAuthUser(), readCart()])
  const count = cart.reduce((n, l) => n + l.qty, 0)
  const showAdmin = !!user?.email_confirmed_at && isAdminEmail(user.email)

  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-6xl items-center gap-4 p-4 text-sm">
        <Link href="/products" className="font-bold">tlbaty</Link>
        <Link href="/cart" className="ms-auto">السلة{count > 0 && ` (${count})`}</Link>
        {user ? (
          <>
            <Link href="/orders">طلباتي</Link>
            {showAdmin && <Link href="/admin">الإدارة</Link>}
            <form action={signout}>
              <button className="underline">خروج</button>
            </form>
          </>
        ) : (
          <>
            <Link href="/login">دخول</Link>
            <Link href="/signup">حساب جديد</Link>
          </>
        )}
      </nav>
    </header>
  )
}
