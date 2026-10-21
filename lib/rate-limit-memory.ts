// حدّ معدّل بسيط في الذاكرة لنقاط البحث العامة (لا تحتاج دقة موزّعة: الهدف كبح الإساءة الواضحة
// من عنوان واحد على نفس النسخة). الجداول الدائمة (OTP/الدخول) تستخدم حدود القاعدة بدل هذا.

const buckets = new Map<string, { count: number; resetAt: number }>()

export function hitRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  b.count += 1
  return b.count > limit
}
