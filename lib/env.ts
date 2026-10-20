import { z } from 'zod'

const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
})

export function getServerEnv() {
  return serverSchema.parse({ DATABASE_URL: process.env.DATABASE_URL })
}
