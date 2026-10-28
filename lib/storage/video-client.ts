import { validateVideoFile } from "@/lib/ads"

// رفع فيديو إعلان من المتصفح مباشرة إلى R2 (رابط موقَّع)، مع قراءة مدته واستخراج صورة غلاف من إطاره الأول.
// دوال المتصفح (inspect/poster) قابلة للحقن في الاختبار كما في upload-client.

export type VideoInfo = { duration: number; width: number; height: number }

export type VideoUploadDeps = {
  inspect?: (file: File) => Promise<VideoInfo>
  request: (contentType: string, size: number) => Promise<{ uploadUrl: string; objectKey: string }>
  put: (uploadUrl: string, file: File) => Promise<void>
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
    const timer = setTimeout(() => reject(new Error("تعذّر قراءة الفيديو، تأكد أنه MP4 (H.264) سليم")), 15000)
    target.addEventListener(event, () => (clearTimeout(timer), resolve()), { once: true })
    target.addEventListener("error", () => (clearTimeout(timer), reject(new Error("تعذّر قراءة الفيديو، تأكد أنه MP4 (H.264) سليم"))), { once: true })
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

async function defaultRequest(contentType: string, size: number) {
  const { requestVideoUpload } = await import("@/app/manage/client-actions")
  return requestVideoUpload(contentType, size)
}

const defaultPut: VideoUploadDeps["put"] = async (uploadUrl, file) => {
  const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
  if (!res.ok) throw new Error("فشل رفع الفيديو إلى التخزين، تحقق من إعدادات CORS للـ bucket")
}

/** يتحقق من النوع والحجم والمدة ثم يرفع الفيديو ويعيد مفتاحه. */
export async function uploadAdVideo(
  file: File,
  deps: VideoUploadDeps = { inspect: inspectVideo, request: defaultRequest, put: defaultPut },
): Promise<string> {
  const info = deps.inspect ? await deps.inspect(file) : undefined
  const problem = validateVideoFile({ type: file.type, size: file.size, duration: info?.duration })
  if (problem) throw new Error(problem)
  const { uploadUrl, objectKey } = await deps.request(file.type, file.size)
  await deps.put(uploadUrl, file)
  return objectKey
}
