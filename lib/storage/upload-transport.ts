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

// PUT already requires a CORS preflight. XHR additionally lets us distinguish a
// slow but progressing upload from a stalled request; fetch exposes no upload progress.
function sendImage(uploadUrl: string, file: File, signal: AbortSignal, progress: (loaded: number) => void): Promise<{ ok: boolean; status: number }> {
  if (typeof XMLHttpRequest === 'undefined') {
    return fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type }, signal })
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const cleanup = () => {
      signal.removeEventListener('abort', abort)
      xhr.onload = xhr.onerror = xhr.onabort = null
      xhr.upload.onprogress = null
    }
    const abort = () => xhr.abort()
    // Register before open/send for browser compatibility. Only the HTTP load
    // event confirms success; uploading all bytes alone does not confirm storage.
    xhr.upload.onprogress = (event) => progress(event.loaded)
    xhr.onload = () => { cleanup(); resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status }) }
    xhr.onerror = () => { cleanup(); reject(new TypeError('Image upload network failure')) }
    xhr.onabort = () => { cleanup(); reject(new DOMException('Upload aborted', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      if (signal.aborted) { cleanup(); reject(new DOMException('Upload aborted', 'AbortError')); return }
      xhr.open('PUT', uploadUrl)
      xhr.setRequestHeader('Content-Type', file.type)
      xhr.send(file)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

export async function putImage(uploadUrl: string, file: File, options: { onTimeout?: () => void } = {}): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await waitUntilOnline()
    const controller = new AbortController()
    // Up to two minutes per attempt, with earlier recovery after 60 seconds of
    // no progress. Five attempts remain bounded and normally fit the 15-minute URL.
    const deadline = setTimeout(() => controller.abort(), 120_000)
    let idleTimer = typeof XMLHttpRequest === 'undefined' ? undefined : setTimeout(() => controller.abort(), 60_000)
    let uploaded = 0
    const progress = (loaded: number) => {
      if (loaded <= uploaded) return
      uploaded = loaded
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => controller.abort(), 60_000)
    }
    let failure: ImageUploadError
    try {
      const response = await sendImage(uploadUrl, file, controller.signal, progress)
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
      clearTimeout(deadline)
      clearTimeout(idleTimer)
    }
    if (attempt === 4) throw offline() ? offlineError() : failure
    await sleep(Math.min(8000, 500 * 2 ** attempt) * (0.7 + Math.random() * 0.6))
  }
}
