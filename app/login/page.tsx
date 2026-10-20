import Link from 'next/link'
import { login } from '@/app/actions/auth'
import { AuthForm } from './auth-form'

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-bold">تسجيل الدخول</h1>
      <AuthForm action={login} submitLabel="دخول" />
      <p className="mt-4 text-sm">
        ليس لديك حساب؟ <Link className="underline" href="/signup">أنشئ حسابًا</Link>
      </p>
    </main>
  )
}
