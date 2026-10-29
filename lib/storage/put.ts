export const UPLOAD_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export type PutOptions = {
  onProgress?: (progress: number) => void
  signal?: AbortSignal
  resign?: () => Promise<string>
  onTimeout?: () => void
}
export class UploadError extends Error {
  constructor(public readonly kind: string, message: string, public readonly status?: number) {
    super(message)
    this.name = kind === 'abort' ? 'AbortError' : 'UploadError'
  }
}
export const abortError = () => new UploadError('abort', 'تم إلغاء الرفع')
export function checkAborted(signal?: AbortSignal) { if (signal?.aborted) throw abortError() }
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false
const offlineError = () => new UploadError('offline', 'لا يوجد اتصال بالإنترنت. تحقق من الاتصال ثم أعد المحاولة.')

function delay(ms: number, signal?: AbortSignal) {
  checkAborted(signal)
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
    const cancel = () => { cleanup(); reject(abortError()) }
    const timer = setTimeout(() => { cleanup(); resolve() }, ms)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}
export async function waitUntilOnline(signal?: AbortSignal): Promise<void> {
  checkAborted(signal)
  if (!offline()) return
  if (typeof window === 'undefined') throw offlineError()
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('online', online); signal?.removeEventListener('abort', cancel) }
    const online = () => { if (!offline()) { cleanup(); resolve() } }
    const cancel = () => { cleanup(); reject(abortError()) }
    const timer = setTimeout(() => { cleanup(); reject(offlineError()) }, 120_000)
    window.addEventListener('online', online)
    signal?.addEventListener('abort', cancel, { once: true })
    online()
  })
}
function attemptPut(url: string, file: File, options: PutOptions): Promise<number> {
  checkAborted(options.signal)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const cleanup = () => { options.signal?.removeEventListener('abort', cancel); xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null; xhr.upload.onprogress = null }
    const fail = (error: UploadError) => { cleanup(); reject(error) }
    const cancel = () => { xhr.abort(); fail(abortError()) }
    xhr.open('PUT', url)
    xhr.timeout = 20_000 + Math.ceil(file.size / 40_000) * 1000
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.setRequestHeader('Cache-Control', UPLOAD_CACHE_CONTROL)
    xhr.upload.onprogress = e => { if (e.lengthComputable) options.onProgress?.(Math.min(0.99, e.loaded / e.total)) }
    xhr.onload = () => { const status = xhr.status; cleanup(); resolve(status) }
    xhr.onerror = () => fail(new UploadError('network', 'تعذّر الاتصال بخادم التخزين'))
    xhr.ontimeout = () => { options.onTimeout?.(); fail(new UploadError('timeout', 'انتهت مهلة الرفع')) }
    xhr.onabort = () => fail(abortError())
    options.signal?.addEventListener('abort', cancel, { once: true })
    try { xhr.send(file) } catch { fail(new UploadError('network', 'تعذّر الاتصال بخادم التخزين')) }
  })
}
async function diagnose(url: string, signal?: AbortSignal): Promise<never> {
  checkAborted(signal)
  if (offline()) throw offlineError()
  try {
    await fetch(url, { mode: 'no-cors', method: 'GET', signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]) })
  } catch {
    checkAborted(signal)
    if (offline()) throw offlineError()
    throw new UploadError('unreachable', 'تعذّر الوصول إلى خادم التخزين. تحقق من الشبكة أو جرّب اتصالاً آخر.')
  }
  // An opaque response establishes reachability, not that CORS is the proven cause.
  throw new UploadError('blocked', 'خادم التخزين متاح لكن الرفع تعذّر؛ قد يكون السبب إعدادات CORS أو انقطاع الاتصال أثناء الرفع. أعد المحاولة أو راجع إعدادات التخزين.')
}
export async function putWithRetry(initialUrl: string, file: File, options: PutOptions = {}): Promise<void> {
  let url = initialUrl
  let resigned = false
  for (let attempt = 1; attempt <= 5; attempt++) {
    await waitUntilOnline(options.signal)
    options.onProgress?.(0)
    const started = performance.now()
    let status: number | undefined
    let errorKind: string | undefined
    try {
      status = await attemptPut(url, file, options)
    } catch (error) {
      if (error instanceof UploadError && error.kind === 'abort') throw error
      errorKind = error instanceof UploadError ? error.kind : 'network'
    } finally {
      const effectiveType = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType
      console.info('[upload]', { stage: 'put', size: file.size, type: file.type, attempt, ...(status !== undefined ? { status } : { errorKind: options.signal?.aborted ? 'abort' : errorKind }), ms: Math.round(performance.now() - started), effectiveType })
    }
    checkAborted(options.signal)
    if (status && status >= 200 && status < 300) { options.onProgress?.(1); return }
    if (status === 403 && options.resign && !resigned && attempt < 5) {
      resigned = true
      try { url = await options.resign() } catch { checkAborted(options.signal); throw new UploadError('signing', 'تعذّر تجديد رابط الرفع. تحقق من جلسة الإدارة ثم أعد المحاولة.') }
      continue
    }
    if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      throw new UploadError('http', status === 403 ? 'رفض خادم التخزين رابط الرفع. تحقق من صلاحيات التخزين ثم أعد المحاولة.' : `رفض خادم التخزين الملف (رمز ${status}). تحقق من الملف ثم أعد المحاولة.`, status)
    }
    if (attempt === 5) return diagnose(url, options.signal)
    await delay(Math.min(8000, 500 * 2 ** (attempt - 1)) * (0.7 + Math.random() * 0.6), options.signal)
  }
}
