import "server-only"
import { randomUUID } from "node:crypto"
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getProofsEnv } from "@/lib/env"

// تخزين ملفات إثبات الدفع (مشفَّرة مسبقاً بـ AES-256-GCM في lib/payment-proof.ts) في bucket خاص.
// المحتوى المخزَّن نص مشفَّر لا يُقرأ بدون المفتاح، والـ bucket لا يُقدَّم للعامة، وتنزيله الوحيد
// عبر مسار الإدارة المحمي الذي يفك التشفير.

const KEY_PATTERN = /^payment-proofs\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.enc$/

let client: S3Client | undefined

function getClient() {
  if (!client) {
    const env = getProofsEnv()
    client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    })
  }
  return client
}

export const isValidProofKey = (key: string) => KEY_PATTERN.test(key)

/** مفتاح فريد لإثبات طلب: payment-proofs/<orderId>/<uuid>.enc */
export function newProofKey(orderId: string): string {
  return `payment-proofs/${orderId}/${randomUUID()}.enc`
}

export async function putPaymentProof(key: string, body: Buffer): Promise<void> {
  if (!isValidProofKey(key)) throw new Error("Invalid proof key")
  await getClient().send(
    new PutObjectCommand({
      Bucket: getProofsEnv().R2_PROOFS_BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/octet-stream",
      CacheControl: "private, no-store",
    }),
  )
}

export async function getPaymentProof(key: string): Promise<Buffer> {
  if (!isValidProofKey(key)) throw new Error("Invalid proof key")
  const res = await getClient().send(new GetObjectCommand({ Bucket: getProofsEnv().R2_PROOFS_BUCKET, Key: key }))
  if (!res.Body) throw new Error("Empty proof object")
  return Buffer.from(await res.Body.transformToByteArray())
}

export async function deletePaymentProof(key: string | null | undefined): Promise<void> {
  if (!key || !isValidProofKey(key)) return
  await getClient().send(new DeleteObjectCommand({ Bucket: getProofsEnv().R2_PROOFS_BUCKET, Key: key }))
}
