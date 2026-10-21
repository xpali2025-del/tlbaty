import { requestPasswordReset } from '@/app/actions/auth'
import { AuthForm } from '@/app/login/auth-form'

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-bold">استعادة كلمة المرور</h1>
      <AuthForm action={requestPasswordReset} submitLabel="إرسال الرابط" fields="email" />
    </main>
  )
}
