import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { describe, expect, it } from 'vitest'

const full = path.resolve(__dirname, '../drizzle')

// مجلد ترحيلات مقتطع عند 0015_otp_channel (آخر ترحيل قبل طرق الدخول)، ثم تُطبَّق البقية من المجلد الكامل
function folderUntil(lastTag: string): string {
  const journal = JSON.parse(fs.readFileSync(path.join(full, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  const keep = journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === lastTag) + 1)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drizzle-partial-'))
  fs.mkdirSync(path.join(dir, 'meta'))
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: keep }))
  for (const e of keep) fs.copyFileSync(path.join(full, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`))
  return dir
}

async function loginMethodAfterUpgrade(otpChannel: string): Promise<string> {
  const db = drizzle(new PGlite())
  await migrate(db, { migrationsFolder: folderUntil('0015_otp_channel') })
  await db.execute(sql.raw(`insert into store.site_settings (id, otp_channel) values (1, '${otpChannel}')`))
  await migrate(db, { migrationsFolder: full })
  const r = (await db.execute(sql.raw('select login_method as m from store.site_settings'))) as unknown as { rows?: { m: string }[] } | { m: string }[]
  return (Array.isArray(r) ? r : (r.rows ?? []))[0].m
}

describe('login_method migration from otp_channel', () => {
  it('maps otp_channel sms to login_method sms', async () => {
    expect(await loginMethodAfterUpgrade('sms')).toBe('sms')
  })
  it('maps whatsapp_sms to wa_web_sms', async () => {
    expect(await loginMethodAfterUpgrade('whatsapp_sms')).toBe('wa_web_sms')
  })
  it('maps whatsapp to wa_web', async () => {
    expect(await loginMethodAfterUpgrade('whatsapp')).toBe('wa_web')
  })
})
