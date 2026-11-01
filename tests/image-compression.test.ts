import { afterEach, describe, expect, it, vi } from 'vitest'
import { compressImage, uploadFormImages, type UploadDeps } from '@/lib/storage/upload-client'
import { IMAGE_FOLDERS } from '@/lib/storage/keys'

const photo = (size = 4_000_000, type = 'image/jpeg') => new File([new Uint8Array(size)], 'phone.jpg', { type })
const output = (size: number, type = 'image/webp') => new Blob([new Uint8Array(size)], { type })

function browser(blobs: Blob[], width = 4000, height = 3000) {
  const drawImage = vi.fn()
  const close = vi.fn()
  const sizes: number[][] = []
  const canvas = {
    width: 0, height: 0, getContext: () => ({ drawImage }),
    toBlob: vi.fn<(callback: BlobCallback, type: string, quality: number) => void>((callback) => {
      sizes.push([canvas.width, canvas.height])
      callback(blobs.shift() ?? output(90_000))
    }),
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close })))
  return { canvas, sizes, drawImage, close }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('shared image compression', () => {
  it.each([
    ['products', 1600], ['slides', 1920], ['ads', 1600], ['categories', 800], ['brands', 600],
    ['reviews', 400], ['payment-accounts', 400], ['couriers', 600], ['notifications', 1200], ['site', 800],
  ] as const)('compresses %s uploads before signing and uploading, without cropping', async (folder, max) => {
    const b = browser([output(90_000)])
    const form = new FormData()
    form.set('image', photo())
    const request = vi.fn(async () => ({ uploadUrl: 'https://storage/upload', objectKey: `${folder}/phone.webp` }))
    const put = vi.fn<UploadDeps['put']>(async () => {})
    await uploadFormImages(form, [{ name: 'image', folder, keyName: 'imageKey' }], { prepare: compressImage, request, put })
    expect(request).toHaveBeenCalledWith(folder, 'image/webp', 90_000)
    expect(put.mock.calls[0][1]).toMatchObject({ size: 90_000, type: 'image/webp', name: 'phone.webp' })
    expect(b.sizes).toEqual([[max, max * 0.75]])
    expect(b.drawImage.mock.calls[0]).toHaveLength(5) // scale the whole source, no cropped source rectangle
    expect(b.close).toHaveBeenCalledOnce()
    expect([b.canvas.width, b.canvas.height]).toEqual([0, 0])
  })

  it('tries bounded quality/dimension steps when the first compressed result is still large', async () => {
    const b = browser([output(2_000_000), output(1_800_000), output(1_000_000), output(800_000), output(400_000)])
    const result = await compressImage(photo(), 'products')
    expect(result.size).toBe(400_000)
    expect(b.sizes).toEqual([[1600, 1200], [1600, 1200], [1200, 900], [1200, 900], [800, 600]])
    expect(b.canvas.toBlob.mock.calls.map((c) => c[2])).toEqual([0.82, 0.72, 0.82, 0.72, 0.82])
  })

  it('keeps portrait proportions and never enlarges a small source', async () => {
    const b = browser([output(90_000)], 300, 600)
    await compressImage(photo(), 'products')
    expect(b.sizes).toEqual([[300, 600]])
  })

  it('keeps the original if all six outputs are larger and releases decoded memory', async () => {
    const b = browser(Array.from({ length: 6 }, () => output(5_000_000)))
    const original = photo()
    expect(await compressImage(original, 'ads')).toBe(original)
    expect(b.canvas.toBlob).toHaveBeenCalledTimes(6)
    expect(b.close).toHaveBeenCalledOnce()
  })

  it('uses the real PNG MIME and extension when WebP encoding is unsupported', async () => {
    const b = browser([output(90_000, 'image/png')])
    const result = await compressImage(photo(), 'site')
    expect(result).toMatchObject({ type: 'image/png', name: 'phone.png', size: 90_000 })
    expect(b.canvas.toBlob).toHaveBeenCalledOnce()
  })

  it.each(['missing', 'rejected'])('falls back to the image element if bitmap decoding is %s', async (mode) => {
    browser([output(90_000)])
    vi.stubGlobal('createImageBitmap', mode === 'missing' ? undefined : vi.fn().mockRejectedValue(new Error('decoder unavailable')))
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-photo')
    vi.stubGlobal('Image', class {
      naturalWidth = 4000; naturalHeight = 3000
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(value: string) { if (value) queueMicrotask(() => this.onload?.()) }
    })
    expect((await compressImage(photo(), 'categories')).size).toBe(90_000)
    expect(revoke).toHaveBeenCalledWith('blob:local-photo')
  })

  it('releases the temporary URL when the fallback decoder fails', async () => {
    browser([])
    vi.stubGlobal('createImageBitmap', undefined)
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:broken')
    vi.stubGlobal('Image', class {
      onerror: (() => void) | null = null
      set src(value: string) { if (value) queueMicrotask(() => this.onerror?.()) }
    })
    const original = photo()
    expect(await compressImage(original, 'categories')).toBe(original)
    expect(revoke).toHaveBeenCalledWith('blob:broken')
  })

  it('rejects a still-large result even if compression reduced it, before any upload', async () => {
    browser(Array.from({ length: 6 }, () => output(2_000_000)))
    const form = new FormData()
    form.set('image', photo())
    const request = vi.fn()
    await expect(uploadFormImages(form, [{ name: 'image', folder: 'ads', keyName: 'imageKey' }], {
      prepare: compressImage, request, put: vi.fn(),
    })).rejects.toThrow('تعذّر ضغط الصورة إلى حجم مناسب')
    expect(request).not.toHaveBeenCalled()
    expect(form.has('imageKey')).toBe(false)
  })

  it('retains small images and unsupported re-encoding types without decoding', async () => {
    const b = browser([])
    for (const file of [photo(100_000), photo(300_000, 'image/avif')]) {
      for (const folder of IMAGE_FOLDERS) expect(await compressImage(file, folder)).toBe(file)
    }
    expect(b.canvas.toBlob).not.toHaveBeenCalled()
  })
})
