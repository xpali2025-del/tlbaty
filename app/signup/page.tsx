import Link from 'next/link'
import { signup } from '@/app/actions/auth'
import { AuthForm } from '@/app/login/auth-form'

export default function SignupPage() {
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-bold">إنشاء حساب</h1>
      <AuthForm action={signup} submitLabel="إنشاء الحساب" />
      <p className="mt-4 text-sm">
        لديك حساب؟ <Link className="underline" href="/login">سجّل الدخول</Link>
      </p>
    </main>
  )
}
