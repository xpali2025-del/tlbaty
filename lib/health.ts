import "server-only"
import { sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { isDbConfigured } from "@/lib/db-cache"
import { isProofStorageConfigured, isR2Configured } from "@/lib/env"
import { checkWorker, type WorkerState } from "@/lib/whatsapp-status"

// فحص صحة النظام لأدوات المراقبة. العام يكشف الحالة فقط؛ التفاصيل لمن يملك CRON_SECRET.

export type DbState = "up" | "down" | "unconfigured"

export type HealthReport = {
  /** ok: كل شيء سليم · degraded: خدمة جانبية متعطلة والمتجر يعمل · down: القاعدة لا تستجيب. */
  status: "ok" | "degraded" | "down"
  db: DbState
  dbLatencyMs: number | null
  worker: WorkerState
  storage: { images: boolean; proofs: boolean }
  checkedAt: string
}

const DB_TIMEOUT_MS = 3000

export async function checkDb(): Promise<{ state: DbState; latencyMs: number | null }> {
  if (!isDbConfigured()) return { state: "unconfigured", latencyMs: null }
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("db timeout")), DB_TIMEOUT_MS)
      }),
    ])
    return { state: "up", latencyMs: Date.now() - started }
  } catch {
    return { state: "down", latencyMs: null }
  } finally {
    clearTimeout(timer)
  }
}

export async function getHealthReport(): Promise<HealthReport> {
  const [dbResult, worker] = await Promise.all([checkDb(), checkWorker()])
  const sideServiceDown = worker === "not_ready" || worker === "unreachable"
  return {
    status: dbResult.state === "down" ? "down" : sideServiceDown ? "degraded" : "ok",
    db: dbResult.state,
    dbLatencyMs: dbResult.latencyMs,
    worker,
    storage: { images: isR2Configured(), proofs: isProofStorageConfigured() },
    checkedAt: new Date().toISOString(),
  }
}
