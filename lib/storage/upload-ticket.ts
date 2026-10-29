import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getR2Env } from '@/lib/env'
import { isValidVideoKey } from './keys'

export function videoUploadTicket(key: string, type: string, size: number, expires = Date.now() + 23 * 60 * 60 * 1000): string {
  const body = Buffer.from(JSON.stringify({ key, type, size, expires })).toString('base64url')
  return `${body}.${createHmac('sha256', getR2Env().R2_SECRET_ACCESS_KEY).update(body).digest('base64url')}`
}
export function verifyVideoUploadTicket(ticket: string, type: string, size: number): string {
  try {
    if (ticket.length > 2048) throw new Error()
    const [body, mac, extra] = ticket.split('.')
    if (!body || !mac || extra) throw new Error()
    const expected = createHmac('sha256', getR2Env().R2_SECRET_ACCESS_KEY).update(body).digest()
    const actual = Buffer.from(mac, 'base64url')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error()
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!isValidVideoKey(payload.key) || payload.type !== type || payload.size !== size || !Number.isFinite(payload.expires) || payload.expires <= Date.now()) throw new Error()
    return payload.key
  } catch { throw new Error('انتهت صلاحية جلسة رفع الفيديو. اختر الملف من جديد.') }
}
