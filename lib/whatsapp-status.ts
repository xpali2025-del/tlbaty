import "server-only"
import { and, count, desc, eq, gte } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { authEvents } from "@/lib/db/store"
import { getBotNumber } from "@/lib/otp/chat-login"

// حالة بوت واتساب للدخول كما تراها لوحة الإدارة: هل الخدمة تعمل ومربوطة، وما رقم البوت، ومتى آخر دخول ناجح.
// الغاية كشف الحظر أو انتهاء الجلسة قبل أن يشتكي العملاء.

export type WorkerState = "ready" | "not_ready" | "unreachable" | "unconfigured"

export type WhatsappStatus = {
  botNumber: string | null
  botNumberSource: "settings" | "env" | "none"
  worker: WorkerState
  /** آخر دخول عبر رد البوت (دليل أن الدائرة كاملة تعمل). */
  lastLoginAt: string | null
  logins24h: number
  checkedAt: string
}

const HEALTH_TIMEOUT_MS = 4000

export async function checkWorker(fetchImpl: typeof fetch = fetch): Promise<WorkerState> {
  const url = process.env.WHATSAPP_WORKER_URL
  if (!url) return "unconfigured"
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  try {
    const res = await fetchImpl(`${url.replace(/\/$/, "")}/health`, { signal: controller.signal, cache: "no-store" })
    if (!res.ok) return "unreachable"
    const body = (await res.json().catch(() => null)) as { ready?: unknown } | null
    return body?.ready === true ? "ready" : "not_ready"
  } catch {
    return "unreachable"
  } finally {
    clearTimeout(timer)
  }
}

export async function getWhatsappStatus(): Promise<WhatsappStatus> {
  const since = new Date(Date.now() - 24 * 3_600_000)
  const viaBot = and(eq(authEvents.event, "otp_sent"), eq(authEvents.detail, "whatsapp-reply"))
  const [bot, worker, [last], [recent]] = await Promise.all([
    getBotNumber(),
    checkWorker(),
    db.select({ at: authEvents.at }).from(authEvents).where(viaBot).orderBy(desc(authEvents.at)).limit(1),
    db.select({ n: count() }).from(authEvents).where(and(viaBot, gte(authEvents.at, since))),
  ])
  return {
    botNumber: bot.number,
    botNumberSource: bot.source,
    worker,
    lastLoginAt: last?.at.toISOString() ?? null,
    logins24h: recent.n,
    checkedAt: new Date().toISOString(),
  }
}
