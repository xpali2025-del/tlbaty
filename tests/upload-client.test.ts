import { describe, expect, it, vi } from 'vitest'
import { uploadFormImages, type UploadDeps } from '@/lib/storage/upload-client'

const file = (name: string, type = 'image/png', size = 100) => new File([new Uint8Array(size)], name, { type })

function deps(): UploadDeps & { puts: string[] } {
  const puts: string[] = []
  let n = 0
  return {
    puts,
    request: vi.fn(async (folder: string, type: string) => ({ uploadUrl: `https://r2/${folder}/${++n}`, objectKey: `${folder}/k${n}.${type.split('/')[1]}` })),
    put: vi.fn(async (url: string) => void puts.push(url)),
  }
}

describe('uploadFormImages', () => {
  it('uploads each file directly, removes the raw files, and sets the keys', async () => {
    const form = new FormData()
    form.set('image', file('a.png'))
    form.append('newImages', file('b.png'))
    form.append('newImages', file('c.png', 'image/webp'))
    form.set('name', 'x')
    const d = deps()
    const keys = await uploadFormImages(form, [
      { name: 'image', folder: 'products', keyName: 'imageKey' },
      { name: 'newImages', folder: 'products', keyName: 'newImageKeys', multiple: true },
    ], d)
    expect(keys).toEqual(['products/k1.png', 'products/k2.png', 'products/k3.webp'])
    expect(form.get('imageKey')).toBe('products/k1.png')
    expect(JSON.parse(form.get('newImageKeys') as string)).toEqual(['products/k2.png', 'products/k3.webp'])
    expect(form.has('image')).toBe(false)
    expect(form.has('newImages')).toBe(false)
    expect(form.get('name')).toBe('x')
    expect(d.puts).toHaveLength(3)
  })

  it('leaves untouched fields alone so the server keeps the current image', async () => {
    const form = new FormData()
    form.set('image', new File([], '')) // empty file input
    const d = deps()
    expect(await uploadFormImages(form, [{ name: 'image', folder: 'brands', keyName: 'imageKey' }], d)).toEqual([])
    expect(form.has('imageKey')).toBe(false)
    expect(form.has('image')).toBe(false)
    expect(d.request).not.toHaveBeenCalled()
  })

  it('validates every file before uploading any, with clear Arabic errors', async () => {
    const d = deps()
    const mixed = new FormData()
    mixed.append('newImages', file('ok.png'))
    mixed.append('newImages', file('doc.pdf', 'application/pdf'))
    await expect(uploadFormImages(mixed, [{ name: 'newImages', folder: 'products', keyName: 'k', multiple: true }], d)).rejects.toThrow('نوع الصورة غير مدعوم')
    expect(d.request).not.toHaveBeenCalled()

    const big = new FormData()
    big.set('image', file('big.png', 'image/png', 6 * 1024 * 1024))
    await expect(uploadFormImages(big, [{ name: 'image', folder: 'products', keyName: 'imageKey' }], d)).rejects.toThrow('يتجاوز 5 ميغابايت')

    const two = new FormData()
    two.append('image', file('a.png'))
    two.append('image', file('b.png'))
    await expect(uploadFormImages(two, [{ name: 'image', folder: 'products', keyName: 'imageKey' }], d)).rejects.toThrow('صورة واحدة')
    expect(d.request).not.toHaveBeenCalled()
  })

  it('propagates upload failures so the form is not saved', async () => {
    const form = new FormData()
    form.set('image', file('a.png'))
    const failing: UploadDeps = {
      request: async () => ({ uploadUrl: 'https://r2/x', objectKey: 'products/k.png' }),
      put: async () => { throw new Error('فشل رفع الصورة') },
    }
    await expect(uploadFormImages(form, [{ name: 'image', folder: 'products', keyName: 'imageKey' }], failing)).rejects.toThrow('فشل رفع الصورة')
    expect(form.has('imageKey')).toBe(false)
  })

  it('uploads the prepared (compressed) file instead of the original, validating the original first', async () => {
    const form = new FormData()
    form.set('image', file('big.png', 'image/png', 4_000_000))
    const d = deps()
    const small = new File([new Uint8Array(50)], 'big.webp', { type: 'image/webp' })
    const prepare = vi.fn(async () => small)
    const keys = await uploadFormImages(form, [{ name: 'image', folder: 'products', keyName: 'imageKey' }], { ...d, prepare })
    expect(prepare).toHaveBeenCalledWith(expect.any(File), 'products')
    expect(d.request).toHaveBeenCalledWith('products', 'image/webp', 50)
    expect(keys).toEqual(['products/k1.webp'])
  })
})
