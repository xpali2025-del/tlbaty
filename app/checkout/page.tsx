import Link from 'next/link'
import { getAuthUser } from '@/lib/supabase/server'
import { CheckoutForm } from './checkout-form'

export const dynamic = 'force-dynamic'

export default async function CheckoutPage() {
  const user = await getAuthUser()
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-bold">إتمام الطلب</h1>
      {user ? (
        <p className="mb-4 text-sm">تسجّل الدخول كـ {user.email}</p>
      ) : (
        <p className="mb-4 text-sm">
          تتابع كضيف، أو <Link className="underline" href="/login">سجّل الدخول</Link> /{' '}
          <Link className="underline" href="/signup">أنشئ حسابًا</Link> لحفظ طلباتك.
        </p>
      )}
      <CheckoutForm email={user?.email ?? undefined} />
    </main>
  )
}
