import { NextResponse } from "next/server"
import { ordersClient } from "@/sanity/orders/client"
import { isManageAuthenticated } from "@/lib/manage-auth"
import { decryptPaymentProof } from "@/lib/payment-proof"

// ============================================
// مسار محمي لعرض إثبات الحوالة داخل لوحة الإدارة فقط.
//
// - يتحقق من جلسة مدير /manage قبل أي شيء.
// - يجلب الملف المشفّر من مشروع الطلبات باستخدام توكن الخادم.
// - يفكّ التشفير في الخادم ويعيد الصورة فقط.
// - لا يعيد رابط Sanity الخام ولا المفتاح ولا IV/AuthTag.
// ============================================

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; sandbox",
}

type ProofDoc = {
  paymentProof?: {
    iv?: string
    authTag?: string
    keyVersion?: string
    originalMimeType?: string
    processedMimeType?: string
    assetUrl?: string
  } | null
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  if (!(await isManageAuthenticated())) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "غير مصرّح." },
      { status: 401, headers: SECURITY_HEADERS },
    )
  }

  const { orderId } = await params
  if (!orderId || !ordersClient) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "الطلب غير موجود." },
      { status: 404, headers: SECURITY_HEADERS },
    )
  }

  let doc: ProofDoc | null = null
  try {
    doc = await ordersClient.fetch<ProofDoc | null>(
      `*[_type == "order" && _id == $id][0]{
        "paymentProof": paymentProof{
          iv, authTag, keyVersion, originalMimeType, processedMimeType,
          "assetUrl": asset.asset->url
        }
      }`,
      { id: orderId },
      { cache: "no-store" },
    )
  } catch {
    return NextResponse.json(
      { ok: false, error: "FETCH_FAILED", message: "تعذّر جلب إثبات الحوالة." },
      { status: 500, headers: SECURITY_HEADERS },
    )
  }

  const proof = doc?.paymentProof
  if (!proof?.assetUrl || !proof.iv || !proof.authTag) {
    return NextResponse.json(
      { ok: false, error: "NO_PROOF", message: "لا يوجد إثبات حوالة لهذا الطلب." },
      { status: 404, headers: SECURITY_HEADERS },
    )
  }

  // الملف مخزّن على Sanity كملف مبهم — نجلبه بتوكن الخادم ثم نفكّ تشفيره.
  const token = process.env.SANITY_ORDERS_TOKEN?.trim()
  let ciphertext: Buffer
  try {
    const res = await fetch(proof.assetUrl, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) throw new Error("asset-fetch-failed")
    ciphertext = Buffer.from(await res.arrayBuffer())
  } catch {
    return NextResponse.json(
      { ok: false, error: "ASSET_FETCH_FAILED", message: "تعذّر تحميل ملف الإثبات." },
      { status: 502, headers: SECURITY_HEADERS },
    )
  }

  let image: Buffer
  try {
    image = decryptPaymentProof({
      ciphertext,
      iv: proof.iv,
      authTag: proof.authTag,
      keyVersion: proof.keyVersion,
    })
  } catch {
    // لا نطبع المفتاح ولا تفاصيل التشفير في السجلات.
    return NextResponse.json(
      { ok: false, error: "DECRYPT_FAILED", message: "تعذّر فك تشفير إثبات الحوالة." },
      { status: 500, headers: SECURITY_HEADERS },
    )
  }

  const download = new URL(req.url).searchParams.get("download") === "1"
  // النوع الفعلي للصورة بعد المعالجة (WebP عادة، أو النوع الأصلي إن لم تُعالَج).
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
      "Content-Disposition": download
        ? `attachment; filename="payment-proof-${orderId}.${extension}"`
        : "inline",
    },
  })
}
