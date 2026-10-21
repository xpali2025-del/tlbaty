import "server-only"

// ============================================
// استخراج IP و User-Agent من الطلب لأغراض التدقيق وتحديد المعدّل.
// نأخذ أول IP في x-forwarded-for (سلسلة الوكلاء)، مع بدائل شائعة.
// ============================================

export function getClientContext(req: Request): { ip: string; userAgent: string } {
  const h = req.headers
  const forwarded = h.get("x-forwarded-for") ?? ""
  const ip =
    forwarded.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    h.get("x-vercel-forwarded-for") ||
    "unknown"
  const userAgent = h.get("user-agent") ?? "unknown"
  return { ip, userAgent }
}
