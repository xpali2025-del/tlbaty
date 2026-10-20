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

export function getServerEnv() {
  return serverSchema.parse({ DATABASE_URL: process.env.DATABASE_URL })
}

export function getR2Env() {
  return r2Schema.parse(process.env)
}
