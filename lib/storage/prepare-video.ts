import { validateVideoFile } from '@/lib/ads'
import { inspectVideo } from './video-client'
import { abortError, checkAborted } from './put'
import { CONVERSION_ERROR, inputVideoType, inspectMp4, isVideoFastPath, TRIM_VIDEO_SECONDS, validateVideoInput } from './video-input'
export class TrimRequiredError extends Error {}
export async function prepareVideo(original: File, options: { signal: AbortSignal; trim: boolean; onProgress: (value: number) => void }) {
  const problem = validateVideoInput(original)
  if (problem) throw new Error(problem)
  checkAborted(options.signal)
  const file = original.type ? original : new File([original], original.name, { type: inputVideoType(original) })
  const info = await inspectVideo(file)
  checkAborted(options.signal)
  if (!Number.isFinite(info.duration) || info.duration <= 0 || info.duration > 600 || info.width <= 0 || info.height <= 0 || info.width * info.height > 4096 * 2160 || Math.max(info.width, info.height) > 4096) throw new Error('الفيديو كبير الأبعاد أو طويل جداً. اختر مقطعاً أصغر.')
  if (info.duration > TRIM_VIDEO_SECONDS && !options.trim) throw new TrimRequiredError(`الفيديو أطول من ${TRIM_VIDEO_SECONDS} ثانية. يمكنك قصه إلى أول ${TRIM_VIDEO_SECONDS} ثانية.`)
  const mp4 = file.type === 'video/mp4' ? await inspectMp4(file) : { h264: false, fastStart: false }
  const fast = isVideoFastPath({ type: file.type, size: file.size, duration: info.duration, h264: mp4.h264 })
  if (fast && mp4.fastStart) return file
  checkAborted(options.signal)
  const result = await new Promise<File>((resolve, reject) => {
    const worker = new Worker(new URL('./video-convert.worker.ts', import.meta.url), { type: 'module' })
    const clean = () => { clearTimeout(timer); worker.terminate(); options.signal.removeEventListener('abort', cancel) }
    const fail = () => { clean(); reject(new Error(CONVERSION_ERROR)) }
    const cancel = () => { clean(); reject(abortError()) }
    const timer = setTimeout(fail, 180_000)
    options.signal.addEventListener('abort', cancel, { once: true })
    worker.onerror = fail
    worker.onmessage = event => {
      if (event.data.type === 'progress') options.onProgress(event.data.progress)
      else if (event.data.type === 'done') { clean(); resolve(event.data.file) }
      else fail()
    }
    worker.postMessage({ file, trim: options.trim, remux: fast })
  })
  checkAborted(options.signal)
  const outInfo = await inspectVideo(result)
  const outputProblem = validateVideoFile({ type: result.type, size: result.size, duration: outInfo.duration })
  const outputMp4 = await inspectMp4(result)
  if (outputProblem || !outputMp4.h264 || !outputMp4.fastStart) throw new Error(CONVERSION_ERROR)
  return result
}
