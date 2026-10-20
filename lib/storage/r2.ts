import 'server-only'
import { randomUUID } from 'node:crypto'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getR2Env } from '@/lib/env'

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}
const MAX_BYTES = 5 * 1024 * 1024

let client: S3Client | undefined

function getClient() {
  if (!client) {
    const env = getR2Env()
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    })
  }
  return client
}

export function publicImageUrl(objectKey: string) {
  return `${getR2Env().R2_PUBLIC_URL.replace(/\/$/, '')}/${objectKey}`
}

/** Returns a short-lived presigned PUT URL plus the object key to store in product_images. */
export async function createImageUpload(contentType: string, size: number) {
  const ext = ALLOWED_TYPES[contentType]
  if (!ext) throw new Error('Unsupported image type')
  if (size <= 0 || size > MAX_BYTES) throw new Error('Invalid image size')

  const objectKey = `products/${randomUUID()}.${ext}`
  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: getR2Env().R2_BUCKET,
      Key: objectKey,
      ContentType: contentType,
      ContentLength: size,
    }),
    { expiresIn: 300 },
  )
  return { uploadUrl, objectKey }
}

const KEY_PATTERN = /^products\/[0-9a-f-]{36}\.(jpg|png|webp|avif)$/

export function isValidImageKey(key: string) {
  return KEY_PATTERN.test(key)
}

export async function deleteImageObject(objectKey: string) {
  if (!isValidImageKey(objectKey)) return
  await getClient().send(new DeleteObjectCommand({ Bucket: getR2Env().R2_BUCKET, Key: objectKey }))
}
