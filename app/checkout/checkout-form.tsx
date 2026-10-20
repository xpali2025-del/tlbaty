'use client'
import { useActionState } from 'react'
import { checkout, type CheckoutState } from '@/app/actions/checkout'

export function CheckoutForm({ email, name }: { email?: string; name?: string }) {
  const [state, action, pending] = useActionState<CheckoutState, FormData>(checkout, {})
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <input name="name" required defaultValue={name} placeholder="الاسم" className="rounded border px-3 py-2" />
      {email ? (
        <p className="text-sm">البريد: {email}</p>
      ) : (
        <input name="email" type="email" required placeholder="البريد الإلكتروني" className="rounded border px-3 py-2" />
      )}
      <input name="phone" placeholder="الجوال (اختياري)" className="rounded border px-3 py-2" />
      {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
      <button disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
        {pending ? 'جارٍ الإرسال…' : 'تأكيد الطلب'}
      </button>
    </form>
  )
}
