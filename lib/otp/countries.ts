import "server-only"
import { db } from "@/lib/db/client"
import { siteSettings } from "@/lib/db/store"
import { countryCodeOf, DEFAULT_LOGIN_COUNTRY, SUPPORTED_COUNTRIES } from "@/lib/phone"

// الدول التي يُسمح لعملائها بتسجيل الدخول (يضبطها المدير من الإعدادات). الافتراضي: اليمن فقط.
// الفرض هنا في الخادم؛ قائمة الاختيار في الواجهة للتسهيل فقط.

const SUPPORTED_CODES: string[] = SUPPORTED_COUNTRIES.map((c) => c.code)

/** يُبقي الأكواد المدعومة فقط (بلا تكرار وبترتيب الدول المدعومة)؛ وإن لم يبقَ شيء فاليمن. */
export function sanitizeLoginCountries(value: unknown): string[] {
  const wanted = new Set(Array.isArray(value) ? value.map(String) : [])
  const kept = SUPPORTED_CODES.filter((c) => wanted.has(c))
  return kept.length > 0 ? kept : [DEFAULT_LOGIN_COUNTRY]
}

export async function getLoginCountries(): Promise<string[]> {
  try {
    const [row] = await db.select({ c: siteSettings.loginCountries }).from(siteSettings).limit(1)
    return sanitizeLoginCountries(row?.c)
  } catch {
    // القاعدة غير متاحة: نرجع للافتراضي (اليمن) حتى لا يتعطل الدخول بسبب قراءة الإعداد.
    return [DEFAULT_LOGIN_COUNTRY]
  }
}

/** هل دولة هذا الرقم الدولي مفعّلة للدخول؟ */
export async function isLoginCountryAllowed(international: string): Promise<boolean> {
  const code = countryCodeOf(international)
  return code !== null && (await getLoginCountries()).includes(code)
}

/** الدول المفعّلة بتفاصيل العرض للواجهة. */
export async function getLoginCountryOptions() {
  const enabled = await getLoginCountries()
  return SUPPORTED_COUNTRIES.filter((c) => enabled.includes(c.code)).map(({ code, name, flag, example }) => ({ code, name, flag, example }))
}

export type LoginCountryOption = Awaited<ReturnType<typeof getLoginCountryOptions>>[number]
