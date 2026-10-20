'use server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type AuthState = { error?: string; message?: string }

const creds = z.object({ email: z.string().email(), password: z.string().min(8) })

export async function login(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = creds.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'بريد إلكتروني أو كلمة مرور غير صالحة (8 أحرف على الأقل)' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) return { error: 'بيانات الدخول غير صحيحة' }
  redirect('/products')
}

export async function signup(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = creds.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'بريد إلكتروني أو كلمة مرور غير صالحة (8 أحرف على الأقل)' }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signUp(parsed.data)
  if (error) return { error: 'تعذّر إنشاء الحساب' }
  if (!data.session) return { message: 'تحقق من بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول' }
  redirect('/products')
}

export async function signout() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/products')
}
