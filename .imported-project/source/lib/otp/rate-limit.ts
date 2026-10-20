import "server-only"

import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { createHmac } from "node:crypto"
import { readSessionSecret } from "./config"

// ============================================
// تحديد معدّل طلبات OTP — الحماية الأساسية عبر Upstash Redis (مشترك بين
// كل نسخ الخادم في بيئة Serverless)، مع حل احتياطي داخل الذاكرة للتطوير المحلي.
//
// ثلاث طبقات: حد لكل رقم، حد لكل IP، وقفل مؤقت بعد كثرة الفشل.
// نبصم القيم الحساسة (الرقم/الـIP) بـ HMAC فلا تُخزَّن خام في Redis.
// ============================================

function createRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    return new Redis({ url, token })
  } catch {
    return null
  }
}

const redis = createRedis()

// حد الإرسال لكل رقم: 5 رسائل في الساعة.
const phoneLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "1 h"), prefix: "tajline:otp:phone" })
  : null

// حد الإرسال لكل IP: 15 رسالة في الساعة (عدة أرقام من نفس الشبكة).
const ipLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(15, "1 h"), prefix: "tajline:otp:ip" })
  : null

// قفل مؤقت بعد كثرة محاولات التحقق الفاشلة: 10 محاولات في 15 دقيقة لكل رقم.
const verifyLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "15 m"), prefix: "tajline:otp:verify" })
  : null

// حل احتياطي داخل الذاكرة (تطوير محلي فقط).
const memory = new Map<string, number[]>()
function limitInMemory(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const hits = (memory.get(key) ?? []).filter((t) => now - t < windowMs)
  if (memory.size > 1000) memory.clear()
  if (hits.length >= max) {
    memory.set(key, hits)
    return false
  }
  hits.push(now)
  memory.set(key, hits)
  return true
}

/** بصمة آمنة لأي قيمة حساسة قبل استخدامها كمفتاح تقييد. */
export function fingerprint(value: string): string {
  try {
    return createHmac("sha256", readSessionSecret()).update(`rl:${value}`).digest("hex").slice(0, 24)
  } catch {
    // في حال غياب المفتاح نستخدم بصمة بسيطة — التطوير فقط.
    return Buffer.from(value).toString("base64url").slice(0, 24)
  }
}

/** يستهلك محاولة إرسال ويعيد ما إذا كانت مسموحة (رقم + IP معاً). */
export async function consumeSendAttempt(phone: string, ip: string): Promise<boolean> {
  const pKey = fingerprint(`phone:${phone}`)
  const iKey = fingerprint(`ip:${ip}`)

  if (phoneLimiter && ipLimiter) {
    try {
      const [p, i] = await Promise.all([phoneLimiter.limit(pKey), ipLimiter.limit(iKey)])
      return p.success && i.success
    } catch {
      return limitInMemory(`p:${pKey}`, 5, 3_600_000) && limitInMemory(`i:${iKey}`, 15, 3_600_000)
    }
  }
  return limitInMemory(`p:${pKey}`, 5, 3_600_000) && limitInMemory(`i:${iKey}`, 15, 3_600_000)
}

/** يستهلك محاولة تحقق ويعيد ما إذا كانت مسموحة (قفل مؤقت للرقم). */
export async function consumeVerifyAttempt(phone: string): Promise<boolean> {
  const key = fingerprint(`verify:${phone}`)
  if (verifyLimiter) {
    try {
      const { success } = await verifyLimiter.limit(key)
      return success
    } catch {
      return limitInMemory(`v:${key}`, 10, 900_000)
    }
  }
  return limitInMemory(`v:${key}`, 10, 900_000)
}
