import "server-only"

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

// ============================================
// معالجة وتشفير إثبات الحوالة
//
// إثبات الحوالة يحتوي بيانات مالية وشخصية، لذلك:
//   - يُعالج على الخادم فقط (إزالة EXIF + تحويل إلى WebP).
//   - يُشفّر بـ AES-256-GCM مع IV عشوائي لكل صورة.
//   - يُرفع كملف من نوع application/octet-stream لا يمكن فتحه كصورة من CDN.
//   - لا يُطبع المفتاح ولا محتوى الصورة في السجلات إطلاقاً.
// ============================================

/** الحد الأقصى للملف المرفوع من العميل قبل المعالجة. */
export const MAX_PROOF_UPLOAD_BYTES = 6 * 1024 * 1024

/** الحجم المستهدف بعد المعالجة — يبقي الطلب الكامل تحت حدود المنصة. */
export const MAX_PROOF_PROCESSED_BYTES = Math.floor(1.2 * 1024 * 1024)

/** أنواع الصور المقبولة — بلا SVG وبلا أي ملف تنفيذي. */
export const ALLOWED_PROOF_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
export type AllowedProofMimeType = (typeof ALLOWED_PROOF_MIME_TYPES)[number]

/** أقصى بعد للصورة بعد المعالجة — يحافظ على وضوح أرقام الحوالة. */
const MAX_PROOF_DIMENSION = 2200

/** جودة WebP — مرتفعة بما يكفي لقراءة الأرقام والنصوص الصغيرة. */
const PROOF_WEBP_QUALITY = 82

export type PaymentProofPayload = {
  /** البيانات المشفّرة الجاهزة للرفع إلى قاعدة البيانات. */
  ciphertext: Buffer
  /** IV بصيغة Base64 — يُحفظ داخل الطلب. */
  iv: string
  /** Authentication Tag بصيغة Base64 — يُحفظ داخل الطلب. */
  authTag: string
  /** إصدار المفتاح المستخدم في التشفير. */
  keyVersion: string
  /** نوع الصورة الأصلي قبل التحويل. */
  originalMimeType: AllowedProofMimeType
  /** نوع الصورة بعد المعالجة (WebP إن نجحت المعالجة). */
  processedMimeType: string
  /** حجم البيانات قبل التشفير. */
  byteSize: number
}

/** خطأ إعداد — يُعرض للعميل كرسالة عربية واضحة بلا تفاصيل حساسة. */
export class PaymentProofConfigError extends Error {}

/** خطأ في الملف المرسل من العميل. */
export class PaymentProofValidationError extends Error {}

// ---------- المفاتيح ----------

/** إصدار المفتاح الحالي المستخدم للتشفير. */
export function currentProofKeyVersion(): string {
  return process.env.PAYMENT_PROOF_KEY_VERSION?.trim() || "1"
}

/**
 * يقرأ مفتاحاً بطول 32 بايت بصيغة Base64.
 * المفتاح الحالي في PAYMENT_PROOF_ENCRYPTION_KEY، والمفاتيح القديمة
 * في PAYMENT_PROOF_ENCRYPTION_KEY_<version> لدعم فك تشفير الصور السابقة.
 */
function readKey(version: string): Buffer {
  const isCurrent = version === currentProofKeyVersion()
  const raw = isCurrent
    ? process.env.PAYMENT_PROOF_ENCRYPTION_KEY
    : (process.env[`PAYMENT_PROOF_ENCRYPTION_KEY_${version}`] ??
      process.env.PAYMENT_PROOF_ENCRYPTION_KEY)

  if (!raw || !raw.trim()) {
    throw new PaymentProofConfigError(
      "خطأ في إعداد الموقع: مفتاح تشفير إثبات الحوالة غير مضبوط. لا يمكن استقبال الحوالات حالياً، ويمكنك استخدام الدفع عند الاستلام.",
    )
  }

  let key: Buffer
  try {
    key = Buffer.from(raw.trim(), "base64")
  } catch {
    throw new PaymentProofConfigError(
      "خطأ في إعداد الموقع: مفتاح تشفير إثبات الحوالة غير صالح.",
    )
  }

  if (key.byteLength !== 32) {
    throw new PaymentProofConfigError(
      "خطأ في إعداد الموقع: مفتاح تشفير إثبات الحوالة يجب أن يكون 32 بايت بصيغة Base64.",
    )
  }

  return key
}

/** هل التشفير مهيّأ؟ يُستخدم لمنع إرسال التحويل مبكراً دون كشف تفاصيل. */
export function isPaymentProofEncryptionReady(): boolean {
  try {
    readKey(currentProofKeyVersion())
    return true
  } catch {
    return false
  }
}

// ---------- التحقق من المحتوى ----------

/**
 * يتحقق من نوع الملف من محتواه الفعلي (Magic Bytes) وليس من الامتداد.
 * يعيد null إذا كان المحتوى غير مدعوم.
 */
function sniffImageMimeType(buffer: Buffer): AllowedProofMimeType | null {
  if (buffer.byteLength < 12) return null

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg"

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (png.every((byte, index) => buffer[index] === byte)) return "image/png"

  // WebP: "RIFF" .... "WEBP"
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp"
  }

  return null
}

// ---------- المعالجة ----------

type ProcessedImage = { data: Buffer; mimeType: string }

/** الدالة القابلة للاستدعاء من حزمة sharp (تُحمّل ديناميكياً). */
type SharpFactory = (
  input: Buffer,
  options?: { failOn?: "none" | "truncated" | "error" | "warning" },
) => import("sharp").Sharp

/**
 * يعالج الصورة بـ sharp إن كانت الحزمة متاحة:
 * تصحيح الاتجاه، إزالة EXIF، تحديد أبعاد قصوى، وتحويل إلى WebP.
 * إذا لم تتوفر sharp تُستخدم البيانات الأصلية كما هي.
 */
async function processProofImage(
  buffer: Buffer,
  originalMimeType: AllowedProofMimeType,
): Promise<ProcessedImage> {
  let sharpModule: SharpFactory | null = null
  try {
    const mod = await import("sharp")
    sharpModule = (mod.default ?? mod) as unknown as SharpFactory
  } catch {
    sharpModule = null
  }

  if (!sharpModule) {
    return { data: buffer, mimeType: originalMimeType }
  }

  try {
    const pipeline = sharpModule(buffer, { failOn: "error" })
    const metadata = await pipeline.metadata()
    if (!metadata.width || !metadata.height) {
      throw new PaymentProofValidationError(
        "تعذّر قراءة صورة إثبات الحوالة. الرجاء اختيار صورة أوضح.",
      )
    }

    let quality = PROOF_WEBP_QUALITY
    let dimension = MAX_PROOF_DIMENSION
    let output: Buffer | null = null

    // نحاول الحفاظ على أعلى جودة ممكنة ضمن الحجم المسموح.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = await sharpModule(buffer, { failOn: "error" })
        .rotate() // يعتمد على EXIF ثم يُزال
        .resize({ width: dimension, height: dimension, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer()

      output = candidate
      if (candidate.byteLength <= MAX_PROOF_PROCESSED_BYTES) break

      quality = Math.max(55, quality - 12)
      dimension = Math.max(1000, Math.round(dimension * 0.85))
    }

    if (!output) {
      throw new PaymentProofValidationError(
        "تعذّرت معالجة صورة إثبات الحوالة. الرجاء اختيار صورة أخرى.",
      )
    }

    if (output.byteLength > MAX_PROOF_PROCESSED_BYTES) {
      throw new PaymentProofValidationError(
        "حجم صورة إثبات الحوالة كبير جداً. الرجاء اختيار صورة أوضح وأصغر حجماً.",
      )
    }

    return { data: output, mimeType: "image/webp" }
  } catch (error) {
    if (error instanceof PaymentProofValidationError) throw error
    // لا نسجّل محتوى الصورة أو تفاصيلها في السجلات.
    throw new PaymentProofValidationError(
      "تعذّر قراءة صورة إثبات الحوالة. الرجاء اختيار صورة بصيغة JPEG أو PNG أو WebP.",
    )
  }
}

// ---------- التشفير ----------

/**
 * يتحقق من الملف، يعالجه، ثم يشفّره بـ AES-256-GCM.
 * يرمي PaymentProofConfigError إذا كان المفتاح مفقوداً،
 * وPaymentProofValidationError إذا كان الملف غير صالح.
 */
export async function prepareEncryptedPaymentProof(
  file: Blob,
): Promise<PaymentProofPayload> {
  if (file.size <= 0) {
    throw new PaymentProofValidationError("صورة إثبات الحوالة مطلوبة.")
  }

  if (file.size > MAX_PROOF_UPLOAD_BYTES) {
    throw new PaymentProofValidationError(
      "حجم صورة إثبات الحوالة كبير جداً. الرجاء اختيار صورة أوضح وأصغر حجماً.",
    )
  }

  const keyVersion = currentProofKeyVersion()
  // نقرأ المفتاح أولاً حتى لا نعالج الصورة إن كان الإعداد ناقصاً.
  const key = readKey(keyVersion)

  const buffer = Buffer.from(await file.arrayBuffer())
  const originalMimeType = sniffImageMimeType(buffer)
  if (!originalMimeType) {
    throw new PaymentProofValidationError(
      "صيغة صورة إثبات الحوالة غير مدعومة. المسموح: JPEG أو PNG أو WebP فقط.",
    )
  }

  const processed = await processProofImage(buffer, originalMimeType)
  if (processed.data.byteLength > MAX_PROOF_PROCESSED_BYTES) {
    throw new PaymentProofValidationError(
      "حجم صورة إثبات الحوالة كبير جداً. الرجاء اختيار صورة أوضح وأصغر حجماً.",
    )
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(processed.data), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    ciphertext,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion,
    originalMimeType,
    processedMimeType: processed.mimeType,
    byteSize: processed.data.byteLength,
  }
}

/** يفكّ تشفير إثبات الحوالة — يُستخدم في مسار الإدارة المحمي فقط. */
export function decryptPaymentProof(params: {
  ciphertext: Buffer
  iv: string
  authTag: string
  keyVersion?: string
}): Buffer {
  const key = readKey(params.keyVersion?.trim() || currentProofKeyVersion())
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(params.iv, "base64"))
  decipher.setAuthTag(Buffer.from(params.authTag, "base64"))
  return Buffer.concat([decipher.update(params.ciphertext), decipher.final()])
}
