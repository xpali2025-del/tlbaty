'use client'
import { useActionState } from 'react'
import type { AuthState } from '@/app/actions/auth'

export function AuthForm({
  action,
  submitLabel,
}: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, {})
  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-3">
      <input name="email" type="email" required placeholder="البريد الإلكتروني" className="rounded border px-3 py-2" />
      <input name="password" type="password" required minLength={8} placeholder="كلمة المرور" className="rounded border px-3 py-2" />
      {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
      <button disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
        {submitLabel}
      </button>
    </form>
  )
}
