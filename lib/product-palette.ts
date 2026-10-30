import "server-only"

import { and, asc, count, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm"
import sharp from "sharp"
import { db } from "@/lib/db/client"
import { products, siteSettings } from "@/lib/db/store"
import { isDbConfigured } from "@/lib/db-cache"
import { isImageSearchEnabled } from "@/lib/site-config"
import { extractPalette, type PaletteColor } from "@/lib/palette"
import { getImageBytes } from "@/lib/storage/r2"

const RETRY_MS = 60 * 60_000
// No settings row means the backward-compatible enabled default.
const enabledSql = sql`coalesce((select ${siteSettings.imageSearchEnabled} from ${siteSettings} limit 1), true)`
const missingSql = sql`${products.imagePalette} = '[]'::jsonb`

/** Process only product images, never customer search images. */
export async function computeImagePalette(imageKey: string | null | undefined): Promise<PaletteColor[]> {
  try {
    const bytes = await getImageBytes(imageKey)
    if (!bytes) return []
    const { data } = await sharp(bytes, { limitInputPixels: 50_000_000 })
      .rotate().resize(64, 64, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return extractPalette(data)
  } catch (error) {
    console.error("palette failed:", error instanceof Error ? error.message : "unknown")
    return []
  }
}

/** A queued job checks the setting again and can never overwrite a newer image's palette. */
export async function refreshProductPalette(productId: string, imageKey: string | null | undefined): Promise<boolean> {
  if (!imageKey || !(await isImageSearchEnabled())) return false
  const palette = await computeImagePalette(imageKey)
  if (palette.length === 0) {
    await db.update(products).set({ imagePaletteRetryAt: new Date(Date.now() + RETRY_MS) })
      .where(and(eq(products.id, productId), eq(products.mainImageKey, imageKey), missingSql, enabledSql))
    return false
  }
  const updated = await db.update(products).set({ imagePalette: palette, imagePaletteRetryAt: null })
    .where(and(eq(products.id, productId), eq(products.mainImageKey, imageKey), enabledSql))
    .returning({ id: products.id })
  return updated.length > 0
}

/** Failures are deferred instead of blocking other products in subsequent batches. */
export async function productsMissingPalette(limit: number) {
  return db.select({ id: products.id, imageKey: products.mainImageKey }).from(products)
    .where(and(isNotNull(products.mainImageKey), missingSql, or(isNull(products.imagePaletteRetryAt), lte(products.imagePaletteRetryAt, new Date()))))
    .orderBy(asc(products.createdAt), asc(products.id)).limit(limit)
}

/** Status does not read or process product image bytes. */
export async function paletteBackfillStatus() {
  const enabled = await isImageSearchEnabled()
  if (!isDbConfigured()) return { enabled, remaining: 0, deferred: 0 }
  const [stats] = await db.select({ remaining: count(), deferred: sql<number>`count(*) filter (where ${products.imagePaletteRetryAt} > now())::int` })
    .from(products).where(and(isNotNull(products.mainImageKey), missingSql))
  return { enabled, remaining: Number(stats?.remaining ?? 0), deferred: Number(stats?.deferred ?? 0) }
}

/** Bounded batch for admin, re-enabling, and the existing daily maintenance job. */
export async function processPaletteBackfill(limit = 40): Promise<{ done: number; attempted: number; remaining: number; deferred: number }> {
  if (!isDbConfigured() || !(await isImageSearchEnabled())) return { done: 0, attempted: 0, remaining: 0, deferred: 0 }
  const batch = await productsMissingPalette(Math.min(Math.max(limit, 1), 40))
  let done = 0, attempted = 0
  for (const item of batch) {
    if (!(await isImageSearchEnabled())) break
    attempted++
    if (await refreshProductPalette(item.id, item.imageKey)) done++
  }
  const status = await paletteBackfillStatus()
  return { done, attempted, remaining: status.remaining, deferred: status.deferred }
}
