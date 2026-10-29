"use client"

import { useEffect, useRef, useState } from 'react'
import { extractVideoPoster, uploadAdVideo } from './video-client'
import { abortError, checkAborted, putWithRetry } from './put'
import { prepareVideo, TrimRequiredError } from './prepare-video'
import { validateVideoInput } from './video-input'

export type VideoResult = { videoKey: string; posterKey: string }
export function useAdVideoUpload() {
  const job = useRef<{ controller: AbortController; result: Promise<VideoResult> } | null>(null)
  const previewRef = useRef<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [needsTrim, setNeedsTrim] = useState(false)

  function cancel() {
    job.current?.controller.abort()
    job.current = null
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = null
  }
  useEffect(() => () => cancel(), [])

  function select(selected: File | null, trim = false) {
    cancel()
    setFile(selected); setError(''); setProgress(0); setStage(''); setPreview(null); setNeedsTrim(false)
    if (!selected) return
    const problem = validateVideoInput(selected)
    if (problem) { setError(problem); return }
    const controller = new AbortController()
    const { signal } = controller
    const url = URL.createObjectURL(selected)
    previewRef.current = url
    setPreview(url)
    setStage('جارٍ تجهيز الفيديو')
    const result = (async () => {
      const prepared = await prepareVideo(selected, { signal, trim, onProgress: value => {
        if (!signal.aborted) { setStage('جارٍ تحويل الفيديو إلى MP4'); setProgress(value) }
      } })
      checkAborted(signal)
      const posterTask = extractVideoPoster(selected).catch(() => extractVideoPoster(prepared)).then(async poster => {
        checkAborted(signal)
        const { requestImageUpload } = await import('@/app/manage/client-actions')
        const slot = await requestImageUpload('ads', poster.type, poster.size)
        checkAborted(signal)
        await putWithRetry(slot.uploadUrl, poster, { signal })
        return slot.objectKey
      })
      const videoTask = uploadAdVideo(prepared, undefined, { signal, onProgress: value => {
        if (!signal.aborted) { setStage(value === 1 ? 'جارٍ إنهاء تجهيز الغلاف' : 'جارٍ رفع الفيديو'); setProgress(value) }
      } })
      const [videoKey, posterKey] = await Promise.all([videoTask, posterTask])
      checkAborted(signal)
      setStage('اكتمل الرفع — جاهز للحفظ'); setProgress(1)
      return { videoKey, posterKey }
    })()
    job.current = { controller, result }
    void result.catch(error => {
      if (!signal.aborted) {
        setNeedsTrim(error instanceof TrimRequiredError)
        setError(error instanceof Error && /[\u0600-\u06ff]/.test(error.message) ? error.message : 'تعذّر تجهيز الفيديو أو رفعه. تحقق من الملف والاتصال ثم أعد المحاولة.')
        setStage('')
        controller.abort()
      }
    })
  }
  async function ready() {
    const current = job.current
    if (!current) throw new Error('اختر ملف الفيديو أولاً')
    const result = await current.result
    if (job.current !== current) throw abortError()
    checkAborted(current.controller.signal)
    return result
  }
  return { file, preview, progress, stage, error, needsTrim, select, ready }
}
