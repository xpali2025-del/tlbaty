import "server-only"
import { db } from "@/lib/db/client"
import { siteSettings } from "@/lib/db/store"
import { OTP_PROVIDER } from "@/lib/otp/config"
import { isOtpChannel } from "@/lib/otp/channel"
import { channelForLegacy, DEFAULT_METHOD, isMethodKey } from "./keys"
import type { MethodKey } from "./types"

export * from "./keys"
export type { LoginMethod, MethodKey, ReadinessCheck } from "./types"

/**
 * طريقة الدخول الفعّالة (تُقرأ من القاعدة بلا كاش فتسري فوراً).
 * إن تعذّرت القراءة نرجع لمتغير OTP_PROVIDER ثم واتساب عبر الخادم، حتى لا يتعطل الدخول بسبب الإعداد.
 */
export async function getActiveMethod(): Promise<MethodKey> {
  try {
    const [row] = await db.select({ m: siteSettings.loginMethod }).from(siteSettings).limit(1)
    if (isMethodKey(row?.m)) return row.m
  } catch (error) {
    // القاعدة غير متاحة: نكمل بالافتراضي لكن نسجّل السبب كي لا يمرّ تجاهل الإعداد بصمت.
    console.error("[otp] login method unreadable, using default:", error instanceof Error ? error.message : error)
  }
  return isOtpChannel(OTP_PROVIDER) ? channelForLegacy(OTP_PROVIDER) : DEFAULT_METHOD
}
