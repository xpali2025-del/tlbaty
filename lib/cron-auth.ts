import "server-only"
import { timingSafeEqual } from "node:crypto"

/** مصادقة المهام المجدولة: Authorization: Bearer $CRON_SECRET بمقارنة ثابتة الزمن. بلا CRON_SECRET يُرفض كل طلب. */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(request.headers.get("authorization") ?? "")
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
