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

const envValue = (name: string) => process.env[`${name}_2`] || process.env[name]

export function getServerEnv() {
  return serverSchema.parse({ DATABASE_URL: envValue("DATABASE_URL") })
}

function r2Env() {
  return {
    R2_ACCOUNT_ID: envValue("R2_ACCOUNT_ID"),
    R2_ACCESS_KEY_ID: envValue("R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: envValue("R2_SECRET_ACCESS_KEY"),
    R2_BUCKET: envValue("R2_BUCKET"),
    R2_PUBLIC_URL: envValue("R2_PUBLIC_URL"),
  }
}

export function getR2Env() {
  return r2Schema.parse(r2Env())
}

/** هل متغيرات R2 كلها مضبوطة؟ (بلا رمي أخطاء — للتحقق قبل عرض/تنفيذ الرفع) */
export function isR2Configured(): boolean {
  return r2Schema.safeParse(r2Env()).success
}

// bucket خاص منفصل لإثباتات الدفع المشفَّرة. لا يُفعَّل له وصول عام ولا نطاق عام أبداً،
// ويُرفض الدفع بالتحويل إن لم يُضبط (فشل مغلق) بدل الرجوع إلى bucket الصور العام.
const proofsSchema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_PROOFS_BUCKET: z.string().min(1),
})

function proofsEnv() {
  return {
    R2_ACCOUNT_ID: envValue("R2_ACCOUNT_ID"),
    R2_ACCESS_KEY_ID: envValue("R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: envValue("R2_SECRET_ACCESS_KEY"),
    R2_PROOFS_BUCKET: envValue("R2_PROOFS_BUCKET"),
  }
}

export function getProofsEnv() {
  return proofsSchema.parse(proofsEnv())
}

export function isProofStorageConfigured(): boolean {
  return proofsSchema.safeParse(proofsEnv()).success
}
