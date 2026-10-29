import { validateVideoFile } from "@/lib/ads"
import { putWithRetry, checkAborted, type PutOptions } from "./put"

// رفع فيديو إعلان من المتصفح مباشرة إلى R2 (رابط موقَّع)، مع قراءة مدته واستخراج صورة غلاف من إطاره الأول.
// دوال المتصفح (inspect/poster) قابلة للحقن في الاختبار كما في upload-client.

export type VideoInfo = { duration: number; width: number; height: number }

export type VideoUploadDeps = {
  inspect?: (file: File) => Promise<VideoInfo>
  request: (contentType: string, size: number, ticket?: string) => Promise<{ uploadUrl: string; objectKey: string; ticket?: string }>
  put: (uploadUrl: string, file: File, options?: PutOptions) => Promise<void>
}

const POSTER_MAX_WIDTH = 1200

function withVideoElement<T>(file: File, run: (video: HTMLVideoElement) => Promise<T>): Promise<T> {
  const url = URL.createObjectURL(file)
  const video = document.createElement("video")
  video.muted = true
  video.playsInline = true
  video.preload = "metadata"
  video.src = url
  const cleanup = () => {
    URL.revokeObjectURL(url)
    video.removeAttribute("src")
    video.load()
  }
  return run(video).finally(cleanup)
}

function once(target: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(event, success); target.removeEventListener("error", failure) }
    const success = () => { cleanup(); resolve() }
    const failure = () => { cleanup(); reject(new Error("تعذّر قراءة الفيديو، اضغطه بصيغة MP4 (H.264) ثم أعد الرفع")) }
    const timer = setTimeout(failure, 15000)
    target.addEventListener(event, success, { once: true })
    target.addEventListener("error", failure, { once: true })
  })
}

export function inspectVideo(file: File): Promise<VideoInfo> {
  return withVideoElement(file, async (video) => {
    await once(video, "loadedmetadata")
    return { duration: video.duration, width: video.videoWidth, height: video.videoHeight }
  })
}

/** يستخرج إطاراً (~0.5 ث) كصورة WebP لتكون غلاف الإعلان قبل التشغيل وللمتصفحات التي تمنع التشغيل التلقائي. */
export function extractVideoPoster(file: File): Promise<File> {
  return withVideoElement(file, async (video) => {
    await once(video, "loadedmetadata")
    const target = Math.min(0.5, Math.max(0, (video.duration || 0) / 2))
    if (target > 0) {
      const seeked = once(video, "seeked")
      video.currentTime = target
      await seeked
    } else {
      await once(video, "loadeddata")
    }
    const scale = Math.min(1, POSTER_MAX_WIDTH / Math.max(video.videoWidth, 1))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("تعذّر استخراج صورة الغلاف، ارفعها يدوياً")
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82))
    if (!blob) throw new Error("تعذّر استخراج صورة الغلاف، ارفعها يدوياً")
    return new File([blob], "poster.webp", { type: "image/webp" })
  })
}

async function defaultRequest(contentType: string, size: number, ticket?: string) {
  const { requestVideoUpload } = await import("@/app/manage/client-actions")
  return requestVideoUpload(contentType, size, ticket)
}

/** يتحقق من النوع والحجم والمدة ثم يرفع الفيديو ويعيد مفتاحه. */
export async function uploadAdVideo(
  file: File,
  deps: VideoUploadDeps = { inspect: inspectVideo, request: defaultRequest, put: putWithRetry },
  options: Pick<PutOptions, "onProgress" | "signal"> = {},
): Promise<string> {
  checkAborted(options.signal)
  const info = deps.inspect ? await deps.inspect(file) : undefined
  checkAborted(options.signal)
  const problem = validateVideoFile({ type: file.type, size: file.size, duration: info?.duration })
  if (problem) throw new Error(problem)
  const { uploadUrl, objectKey, ticket } = await deps.request(file.type, file.size)
  checkAborted(options.signal)
  await deps.put(uploadUrl, file, {
    ...options,
    resign: ticket ? async () => {
      checkAborted(options.signal)
      const renewed = await deps.request(file.type, file.size, ticket)
      if (renewed.objectKey !== objectKey) throw new Error("تغيّر مفتاح الفيديو أثناء تجديد الرابط")
      return renewed.uploadUrl
    } : undefined,
  })
  checkAborted(options.signal)
  return objectKey
}
