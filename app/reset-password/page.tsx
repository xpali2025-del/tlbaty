import { updatePassword } from '@/app/actions/auth'
import { AuthForm } from '@/app/login/auth-form'

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-bold">كلمة مرور جديدة</h1>
      <AuthForm action={updatePassword} submitLabel="تحديث كلمة المرور" fields="password" />
    </main>
  )
}
