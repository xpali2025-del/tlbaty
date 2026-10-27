import 'server-only'
import { randomUUID } from 'node:crypto'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getR2Env } from '@/lib/env'
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, isImageFolder, isValidImageKey, isValidVideoKey, type ImageFolder } from './keys'
import { ALLOWED_VIDEO_TYPES, MAX_VIDEO_BYTES } from '@/lib/ads'

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

/** Returns a short-lived presigned PUT URL plus the object key to store in the database. */
export async function createImageUpload(contentType: string, size: number, folder: ImageFolder = 'products') {
  const ext = ALLOWED_IMAGE_TYPES[contentType]
  if (!ext) throw new Error('Unsupported image type')
  if (!isImageFolder(folder)) throw new Error('Unknown image folder')
  if (size <= 0 || size > MAX_IMAGE_BYTES) throw new Error('Invalid image size')

  const objectKey = `${folder}/${randomUUID()}.${ext}`
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

/** Presigned PUT for an ad video (MP4, ads/ folder only). */
export async function createVideoUpload(contentType: string, size: number) {
  const ext = ALLOWED_VIDEO_TYPES[contentType]
  if (!ext) throw new Error('Unsupported video type')
  if (size <= 0 || size > MAX_VIDEO_BYTES) throw new Error('Invalid video size')

  const objectKey = `ads/${randomUUID()}.${ext}`
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

/** Deletes an uploaded image or ad video. Silently ignores values that are not valid public keys (legacy paths, URLs). */
export async function deleteImageObject(objectKey: string | null | undefined) {
  if (!objectKey) return
  if (!isValidImageKey(objectKey) && !isValidVideoKey(objectKey)) return
  await getClient().send(new DeleteObjectCommand({ Bucket: getR2Env().R2_BUCKET, Key: objectKey }))
}

/** Reads an uploaded public image (for server-side analysis such as the color palette). Null for non-R2 keys or oversized objects. */
export async function getImageBytes(objectKey: string | null | undefined): Promise<Buffer | null> {
  if (!objectKey || !isValidImageKey(objectKey)) return null
  const res = await getClient().send(new GetObjectCommand({ Bucket: getR2Env().R2_BUCKET, Key: objectKey }))
  if (!res.Body || (res.ContentLength ?? 0) > MAX_IMAGE_BYTES) return null
  return Buffer.from(await res.Body.transformToByteArray())
}
