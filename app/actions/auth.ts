'use server'
import { headers } from 'next/headers'
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

async function siteOrigin() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}

// Always reports success so the form can't be used to discover which emails have accounts.
export async function requestPasswordReset(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z.string().email().safeParse(formData.get('email'))
  if (parsed.success) {
    const supabase = await createSupabaseServerClient()
    await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${await siteOrigin()}/auth/callback`,
    })
  }
  return { message: 'إن كان البريد مسجّلًا فقد أرسلنا إليه رابط استعادة كلمة المرور' }
}

export async function updatePassword(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z.string().min(8).safeParse(formData.get('password'))
  if (!parsed.success) return { error: 'كلمة المرور 8 أحرف على الأقل' }
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return { error: 'انتهت صلاحية الرابط، اطلب رابطًا جديدًا' }
  const { error } = await supabase.auth.updateUser({ password: parsed.data })
  if (error) return { error: 'تعذّر تحديث كلمة المرور' }
  redirect('/products')
}
