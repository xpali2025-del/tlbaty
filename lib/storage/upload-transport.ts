export class ImageUploadError extends Error {
  constructor(public readonly kind: 'offline' | 'timeout' | 'network' | 'http', message: string, public readonly status?: number) {
    super(message)
    this.name = 'ImageUploadError'
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false

export function uploadConcurrency(): number {
  if (typeof navigator === 'undefined') return 3
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection
  if (!connection) return 3
  if (connection.saveData || /(^|-)2g$/.test(connection.effectiveType ?? '')) return 1
  return connection.effectiveType === '3g' ? 2 : 4
}

export async function waitUntilOnline(): Promise<void> {
  if (!offline()) return
  if (typeof window === 'undefined') throw offlineError()
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('online', onOnline)
    }
    const onOnline = () => {
      if (offline()) return
      cleanup()
      resolve()
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(offlineError())
    }, 120_000)
    window.addEventListener('online', onOnline)
    onOnline()
  })
}

function offlineError() {
  return new ImageUploadError('offline', 'لا يوجد اتصال بالإنترنت. تحقق من الاتصال ثم أعد محاولة الرفع.')
}

export async function putImage(uploadUrl: string, file: File, options: { onTimeout?: () => void } = {}): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await waitUntilOnline()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000 + Math.ceil(file.size / 40_000) * 1000)
    let failure: ImageUploadError
    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT', body: file, headers: { 'Content-Type': file.type }, signal: controller.signal,
      })
      if (response.ok) return
      failure = new ImageUploadError('http', response.status === 403
        ? 'رفض خادم التخزين رابط الرفع أو انتهت صلاحيته. أعد المحاولة، وإذا استمر الخطأ فتحقق من إعدادات التخزين.'
        : `فشل رفع الصورة إلى التخزين (HTTP ${response.status}). أعد المحاولة.`, response.status)
      if (![408, 429].includes(response.status) && response.status < 500) throw failure
    } catch (error) {
      if (error instanceof ImageUploadError) throw error
      if (controller.signal.aborted) {
        options.onTimeout?.()
        failure = new ImageUploadError('timeout', 'انتهت مهلة رفع الصورة. جرّب صورة أصغر أو شبكة أسرع ثم أعد المحاولة.')
      } else {
        // A rejected browser fetch cannot distinguish CORS from DNS/TLS or a dropped connection.
        failure = new ImageUploadError('network', 'تعذّر رفع الصورة من المتصفح. تحقق من الشبكة، وإذا استمر الخطأ فتحقق من إعدادات CORS للتخزين.')
      }
    } finally {
      clearTimeout(timer)
    }
    if (attempt === 4) throw offline() ? offlineError() : failure
    await sleep(Math.min(8000, 500 * 2 ** attempt) * (0.7 + Math.random() * 0.6))
  }
}
