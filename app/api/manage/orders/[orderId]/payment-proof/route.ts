import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { isDbConfigured } from "@/lib/db-cache"
import { orderPaymentProofs } from "@/lib/db/store"
import { hasManagePermission } from "@/lib/manage-auth"
import { decryptPaymentProof } from "@/lib/payment-proof"
import { getPaymentProof } from "@/lib/storage/proofs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ترويسات أمنية صارمة: لا كاش أبداً، ومنع المسح التلقائي للنوع، وعزل المحتوى.
const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; sandbox",
}

const json = (body: Record<string, unknown>, status: number) =>
  NextResponse.json(body, { status, headers: SECURITY_HEADERS })

/**
 * تنزيل/عرض إثبات الدفع لطلب معيّن — لمديري اللوحة فقط.
 * يقرأ الملف المشفَّر من التخزين الخاص ويفك تشفيره على الخادم؛ لا يوجد أي رابط عام للملف.
 */
export async function GET(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  if (!(await hasManagePermission("orders"))) {
    return json({ ok: false, error: "UNAUTHORIZED", message: "غير مصرّح." }, 401)
  }

  const { orderId } = await params
  if (!orderId || !UUID.test(orderId) || !isDbConfigured()) {
    return json({ ok: false, error: "NOT_FOUND", message: "الطلب غير موجود." }, 404)
  }

  let proof: typeof orderPaymentProofs.$inferSelect | undefined
  try {
    ;[proof] = await db.select().from(orderPaymentProofs).where(eq(orderPaymentProofs.orderId, orderId)).limit(1)
  } catch {
    return json({ ok: false, error: "FETCH_FAILED", message: "تعذّر جلب إثبات الحوالة." }, 500)
  }
  if (!proof) {
    return json({ ok: false, error: "NO_PROOF", message: "لا يوجد إثبات حوالة لهذا الطلب." }, 404)
  }

  let ciphertext: Buffer
  try {
    ciphertext = await getPaymentProof(proof.objectKey)
  } catch {
    return json({ ok: false, error: "ASSET_FETCH_FAILED", message: "تعذّر تحميل ملف الإثبات." }, 502)
  }

  let image: Buffer
  try {
    image = decryptPaymentProof({ ciphertext, iv: proof.iv, authTag: proof.authTag, keyVersion: proof.keyVersion })
  } catch {
    return json({ ok: false, error: "DECRYPT_FAILED", message: "تعذّر فك تشفير إثبات الحوالة." }, 500)
  }

  const download = new URL(req.url).searchParams.get("download") === "1"
  const allowed = new Set(["image/webp", "image/jpeg", "image/png"])
  const candidate = proof.processedMimeType || proof.originalMimeType || "image/webp"
  const mimeType = allowed.has(candidate) ? candidate : "image/webp"
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp"

  return new NextResponse(new Uint8Array(image), {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": mimeType,
      "Content-Length": String(image.byteLength),
      "Content-Disposition": download ? `attachment; filename="payment-proof-${orderId}.${extension}"` : "inline",
    },
  })
}
