import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: ['./lib/db/schema.ts', './lib/db/store/index.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
})
