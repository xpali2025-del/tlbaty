'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { registerImage, requestImageUpload } from '@/app/actions/admin'

const MAX_BYTES = 5 * 1024 * 1024

export function ImageUploader({ productId }: { productId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function onFile(file: File | undefined, alt: string) {
    if (!file) return
    setError(undefined)
    if (file.size > MAX_BYTES) return setError('الحجم الأقصى 5 ميغابايت')
    setBusy(true)
    try {
      const { uploadUrl, objectKey } = await requestImageUpload(file.type, file.size)
      const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      if (!res.ok) throw new Error('upload failed')
      await registerImage(productId, objectKey, alt)
      router.refresh()
    } catch {
      setError('تعذّر رفع الصورة (jpeg أو png أو webp أو avif)')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input id="alt" placeholder="وصف الصورة (alt)" className="rounded border px-3 py-2" />
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        disabled={busy}
        onChange={(e) => {
          const alt = (document.getElementById('alt') as HTMLInputElement).value
          void onFile(e.target.files?.[0], alt)
          e.target.value = ''
        }}
      />
      {busy && <p>جارٍ الرفع…</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  )
}
