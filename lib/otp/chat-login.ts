import "server-only"
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto"
import { and, eq, gt, isNull } from "drizzle-orm"
import { cookies } from "next/headers"
import { db } from "@/lib/db/client"
import { loginChallenges, siteSettings } from "@/lib/db/store"
import { hashSessionToken } from "./hash"

export const CHALLENGE_COOKIE = "login_challenge"
export const CHALLENGE_TTL_SECONDS = 600

// بلا حروف وأرقام متشابهة (0/O و1/I/L)، حتى لا يخطئ العميل إن كتب الرمز يدوياً.
const TOKEN_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
export const TOKEN_LENGTH = 6
export const TOKEN_PATTERN = new RegExp(`\\b[${TOKEN_ALPHABET}]{${TOKEN_LENGTH}}\\b`)

export type Challenge = typeof loginChallenges.$inferSelect

function randomToken(): string {
  let out = ""
  for (let i = 0; i < TOKEN_LENGTH; i++) out += TOKEN_ALPHABET[randomInt(0, TOKEN_ALPHABET.length)]
  return out
}

/**
 * رقم بوت الدخول: من إعدادات الموقع (لوحة الإدارة، يتغير فوراً عند الحظر) وإلا من WHATSAPP_BOT_NUMBER.
 * يُقرأ من القاعدة مباشرة (لا كاش) فيسري التغيير على أول عميل بعد الحفظ.
 */
export async function getBotNumber(): Promise<{ number: string | null; source: "settings" | "env" | "none" }> {
  try {
    const [row] = await db.select({ n: siteSettings.loginBotNumber }).from(siteSettings).limit(1)
    const saved = (row?.n ?? "").replace(/\D/g, "")
    if (saved.length >= 8) return { number: saved, source: "settings" }
  } catch {
    // القاعدة غير متاحة: نرجع للمتغير حتى لا يتعطل الدخول بسبب قراءة الإعداد.
  }
  const env = (process.env.WHATSAPP_BOT_NUMBER ?? "").replace(/\D/g, "")
  return env.length >= 8 ? { number: env, source: "env" } : { number: null, source: "none" }
}

/** رابط wa.me برسالة جاهزة تحمل رمز الطلب (رقم البوت أرقام دولية فقط). */
export function buildChatLink(token: string, botNumber: string | null): string | null {
  const number = (botNumber ?? "").replace(/\D/g, "")
  if (number.length < 8) return null
  return `https://wa.me/${number}?text=${encodeURIComponent(`رمز الدخول: ${token}`)}`
}

/** ينشئ تحدّياً جديداً ويربطه بالمتصفح عبر كوكي HttpOnly (السر يُخزَّن مجزأً فقط). */
export async function startChallenge(input: { ip: string; userAgent: string }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = randomToken()
    const browserSecret = randomBytes(32).toString("hex")
    const [row] = await db
      .insert(loginChallenges)
      .values({
        token,
        browserSecretHash: hashSessionToken(browserSecret),
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
        ip: input.ip,
        userAgent: input.userAgent.slice(0, 300),
      })
      .onConflictDoNothing({ target: loginChallenges.token })
      .returning()
    if (!row) continue // تصادم نادر في الرمز القصير: نجرب رمزاً آخر.
    ;(await cookies()).set(CHALLENGE_COOKIE, browserSecret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth",
      maxAge: CHALLENGE_TTL_SECONDS,
    })
    return { token, expiresAt: row.expiresAt }
  }
  throw new Error("CHALLENGE_CREATE_FAILED")
}

/** التحدّي المرتبط بهذا المتصفح (إن وُجد وكان غير منتهٍ ولم يُستهلك). */
export async function getChallengeForBrowser(): Promise<Challenge | null> {
  const secret = (await cookies()).get(CHALLENGE_COOKIE)?.value
  if (!secret) return null
  let hash: string
  try {
    hash = hashSessionToken(secret)
  } catch {
    return null
  }
  const [row] = await db.select().from(loginChallenges).where(eq(loginChallenges.browserSecretHash, hash)).limit(1)
  if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) return null
  return row
}

/** هل الرمز لطلب قائم لم يُطالَب به ولم ينتهِ؟ (قراءة فقط، قبل إصدار أي رمز دخول). */
export async function isClaimable(token: string): Promise<boolean> {
  const [row] = await db
    .select({ id: loginChallenges.id })
    .from(loginChallenges)
    .where(and(eq(loginChallenges.token, token), isNull(loginChallenges.claimedAt), gt(loginChallenges.expiresAt, new Date())))
    .limit(1)
  return !!row
}

/** يربط الرقم المُثبَت من واتساب بالتحدّي. ذرّي: يفوز أول مطالِب فقط، ويرفض المنتهي. */
export async function claimChallenge(token: string, phone: string): Promise<Challenge | null> {
  const [row] = await db
    .update(loginChallenges)
    .set({ phone, claimedAt: new Date() })
    .where(and(eq(loginChallenges.token, token), isNull(loginChallenges.claimedAt), gt(loginChallenges.expiresAt, new Date())))
    .returning()
  return row ?? null
}

/** يستهلك التحدّي بعد نجاح التحقق (مرة واحدة). */
export async function consumeChallenge(id: string): Promise<boolean> {
  const rows = await db
    .update(loginChallenges)
    .set({ consumedAt: new Date() })
    .where(and(eq(loginChallenges.id, id), isNull(loginChallenges.consumedAt)))
    .returning({ id: loginChallenges.id })
  return rows.length > 0
}

export async function clearChallengeClaim(): Promise<void> {
  ;(await cookies()).delete(CHALLENGE_COOKIE)
}

/** مصادقة نداء الخدمة (Bearer) بمقارنة ثابتة الزمن مع WHATSAPP_WORKER_TOKEN. */
export function isWorkerAuthorized(req: Request): boolean {
  const expected = process.env.WHATSAPP_WORKER_TOKEN ?? ""
  if (expected.length < 16) return false
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""))
  const want = Buffer.from(expected)
  return given.length === want.length && timingSafeEqual(given, want)
}
