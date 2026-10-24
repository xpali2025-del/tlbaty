// تشخيص أخطاء قاعدة البيانات لشاشة المدير: يفرّق بين «لم تُشغَّل الترحيلات» ومشكلة الاتصال والباقي،
// حتى لا يرى المدير صفحة بيضاء أو رسالة عامة. لا يُعرض إلا لمدير مسجّل الدخول.

export type DbErrorKind = "migration" | "connection" | "permission" | "unknown"

/** drizzle يغلّف خطأ postgres في cause، فنمشي على السلسلة بحثاً عن الرمز. */
function causeChain(error: unknown): { code?: string; message?: string }[] {
  const out: { code?: string; message?: string }[] = []
  let current: unknown = error
  for (let i = 0; i < 6 && current && typeof current === "object"; i++) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown }
    out.push({ code: typeof e.code === "string" ? e.code : undefined, message: typeof e.message === "string" ? e.message : undefined })
    current = e.cause
  }
  return out
}

export function classifyDbError(error: unknown): DbErrorKind {
  const chain = causeChain(error)
  const codes = chain.map((c) => c.code)
  // 42703 عمود غير موجود، 42P01 جدول غير موجود، 3F000 مخطط غير موجود، 42704 نوع/enum غير موجود
  if (codes.some((c) => c === "42703" || c === "42P01" || c === "3F000" || c === "42704")) return "migration"
  if (codes.some((c) => c === "42501")) return "permission"
  const text = chain.map((c) => `${c.code ?? ""} ${c.message ?? ""}`).join(" ")
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|CONNECT_TIMEOUT|CONNECTION_CLOSED|28P01|28000|DATABASE_URL/i.test(text)) return "connection"
  return "unknown"
}

export const DB_ERROR_HINTS: Record<DbErrorKind, string> = {
  migration:
    "قاعدة البيانات ينقصها تحديث (ترحيلات لم تُشغَّل بعد). شغّل الأمر `pnpm db:migrate` على قاعدة الإنتاج (بنفس DATABASE_URL المضبوط في Vercel) ثم أعد تحميل الصفحة.",
  connection: "تعذّر الاتصال بقاعدة البيانات. تأكد من DATABASE_URL في إعدادات Vercel (الرابط والكلمة) وأن القاعدة تعمل.",
  permission: "حساب قاعدة البيانات لا يملك صلاحية القراءة المطلوبة. راجع المستخدم المستعمل في DATABASE_URL وصلاحياته على مخطط store.",
  unknown: "حدث خطأ غير متوقع أثناء تحميل بيانات اللوحة. راجع سجلات Vercel (Runtime Logs) باستعمال الرمز أدناه.",
}
