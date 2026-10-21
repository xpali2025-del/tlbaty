import { z } from 'zod'

const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
})

const r2Schema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_PUBLIC_URL: z.string().url(),
})

const supabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
})

export function getSupabaseEnv() {
  return supabaseSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })
}

export function getServerEnv() {
  return serverSchema.parse({ DATABASE_URL: process.env.DATABASE_URL })
}

export function getR2Env() {
  return r2Schema.parse(process.env)
}

/** هل متغيرات R2 كلها مضبوطة؟ (بلا رمي أخطاء — للتحقق قبل عرض/تنفيذ الرفع) */
export function isR2Configured(): boolean {
  return r2Schema.safeParse(process.env).success
}

// bucket خاص منفصل لإثباتات الدفع المشفَّرة. لا يُفعَّل له وصول عام ولا نطاق عام أبداً،
// ويُرفض الدفع بالتحويل إن لم يُضبط (فشل مغلق) بدل الرجوع إلى bucket الصور العام.
const proofsSchema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_PROOFS_BUCKET: z.string().min(1),
})

export function getProofsEnv() {
  return proofsSchema.parse(process.env)
}

export function isProofStorageConfigured(): boolean {
  return proofsSchema.safeParse(process.env).success
}
