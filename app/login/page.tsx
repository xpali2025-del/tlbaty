import Link from 'next/link'
import { login } from '@/app/actions/auth'
import { AuthForm } from './auth-form'

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-bold">تسجيل الدخول</h1>
      <AuthForm action={login} submitLabel="دخول" />
      <p className="mt-4 text-sm">
        <Link className="underline" href="/forgot-password">نسيت كلمة المرور؟</Link>
      </p>
      <p className="mt-2 text-sm">
        ليس لديك حساب؟ <Link className="underline" href="/signup">أنشئ حسابًا</Link>
      </p>
    </main>
  )
}
