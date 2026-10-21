"use client"

import { extractPalette, type PaletteColor } from "@/lib/palette"

const MAX_SIDE = 64
const MAX_BYTES = 12 * 1024 * 1024

/** صورة المستخدم → بصمة ألوان داخل المتصفح (لا تُرفع الصورة). ترمي رسالة عربية واضحة عند الفشل. */
export async function paletteFromFile(file: File): Promise<{ palette: PaletteColor[]; previewUrl: string }> {
  if (!file.type.startsWith("image/")) throw new Error("اختر ملف صورة (JPEG أو PNG أو WebP).")
  if (file.size > MAX_BYTES) throw new Error("حجم الصورة كبير جداً. اختر صورة أصغر من 12 ميجابايت.")

  const previewUrl = URL.createObjectURL(file)
  try {
    const bitmap = await loadBitmap(file, previewUrl)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) throw new Error("المتصفح لا يدعم تحليل الصور.")
    ctx.drawImage(bitmap, 0, 0, w, h)
    const palette = extractPalette(ctx.getImageData(0, 0, w, h).data)
    if (palette.length === 0) throw new Error("لم نتمكن من استخراج ألوان من هذه الصورة. جرّب صورة أوضح.")
    return { palette, previewUrl }
  } catch (error) {
    URL.revokeObjectURL(previewUrl)
    throw error
  }
}

async function loadBitmap(file: File, url: string): Promise<{ width: number; height: number } & CanvasImageSource> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file)
    } catch {
      // نرجع للطريقة التقليدية (بعض الصيغ لا يدعمها createImageBitmap)
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("تعذّر قراءة الصورة. جرّب صورة أخرى."))
    img.src = url
  })
}
