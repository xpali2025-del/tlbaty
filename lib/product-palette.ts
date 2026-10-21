import "server-only"

import { and, asc, eq, isNotNull, sql } from "drizzle-orm"
import sharp from "sharp"
import { db } from "@/lib/db/client"
import { products } from "@/lib/db/store"
import { extractPalette, type PaletteColor } from "@/lib/palette"
import { getImageBytes } from "@/lib/storage/r2"

/** بصمة ألوان صورة منتج محفوظة في R2: تُصغَّر إلى 64px ثم تُستخرج الألوان. فارغة إن تعذّر القراءة/التحليل. */
export async function computeImagePalette(imageKey: string | null | undefined): Promise<PaletteColor[]> {
  try {
    const bytes = await getImageBytes(imageKey)
    if (!bytes) return []
    const { data } = await sharp(bytes, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize(64, 64, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return extractPalette(data)
  } catch (error) {
    console.error("palette failed:", error instanceof Error ? error.message : "unknown")
    return []
  }
}

/** يحسب ويحفظ بصمة منتج واحد (أفضل جهد: الفشل لا يمنع حفظ المنتج). */
export async function refreshProductPalette(productId: string, imageKey: string | null | undefined): Promise<boolean> {
  const palette = await computeImagePalette(imageKey)
  if (palette.length === 0) return false
  await db.update(products).set({ imagePalette: palette }).where(eq(products.id, productId))
  return true
}

/** المنتجات التي لها صورة وبلا بصمة بعد، لتعبئتها دفعة دفعة. */
export async function productsMissingPalette(limit: number) {
  return db
    .select({ id: products.id, imageKey: products.mainImageKey })
    .from(products)
    .where(and(isNotNull(products.mainImageKey), sql`${products.imagePalette} = '[]'::jsonb`))
    .orderBy(asc(products.createdAt))
    .limit(limit)
}
