import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  discardPreUpload,
  getPreUpload,
  releasePreUpload,
  resetPreUploads,
  setDiscardHandler,
} from '@/lib/storage/preupload-registry'
import { startPreUpload, uploadFormImages, type UploadDeps, type UploadField } from '@/lib/storage/upload-client'

// الرفع المسبق (المرحلة 2): يبدأ عند اختيار الصورة، والحفظ ينتظر ما لم يكتمل فقط.

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5))
let stamp = 0
const photo = (name: string, size = 1000) => new File([new Uint8Array(size)], name, { type: 'image/webp', lastModified: 1_000 + ++stamp })

const everyOpenAll: (() => void)[] = []

/** اعتماديات وهمية: كل PUT ينتظر «بوابة» يفتحها الاختبار، فنتحكم في ما اكتمل وما لم يكتمل. */
function makeDeps() {
  let n = 0
  const gates = new Map<string, () => void>()
  const open = (index: number) => gates.get(`https://r2/${index}`)?.()
  const deps = {
    prepare: vi.fn(async (file: File) => file),
    request: vi.fn(),
    requestBatch: vi.fn(async (items: { folder: string }[]) => items.map((item) => ({ uploadUrl: `https://r2/${++n}`, objectKey: `${item.folder}/k${n}.webp` }))),
    put: vi.fn((url: string) => new Promise<void>((resolve) => gates.set(url, resolve))),
  } satisfies UploadDeps
  const openAll = () => gates.forEach((resolve) => resolve())
  everyOpenAll.push(openAll)
  return { deps, open, openAll }
}

const fields: UploadField[] = [{ name: 'newImages', folder: 'products', keyName: 'newImageKeys', multiple: true }]
const formWith = (files: File[]) => {
  const form = new FormData()
  for (const f of files) form.append('newImages', f)
  return form
}

beforeEach(() => {
  resetPreUploads()
  setDiscardHandler(null)
})

// رفع معلّق في اختبار ما يحجز خانة من حدّ التزامن في الوحدة (مشتركة بين الاختبارات): نُنهي كل ما تُرك
afterEach(async () => {
  while (everyOpenAll.length) everyOpenAll.pop()!()
  await tick()
})

describe('pre-upload starts when the image is chosen', () => {
  it('upload starts on select, before save', async () => {
    const { deps, open } = makeDeps()
    const file = photo('a.webp')
    const pre = startPreUpload(file, 'products', 'newImages', deps)
    await tick()
    // no save has happened: compress, sign and PUT are already under way
    expect(deps.prepare).toHaveBeenCalledTimes(1)
    expect(deps.requestBatch).toHaveBeenCalledTimes(1)
    expect(deps.put).toHaveBeenCalledTimes(1)
    expect(pre.state).toBe('working')
    open(1)
    expect(await pre.promise).toBe('products/k1.webp')
    await tick()
    expect(pre.state).toBe('done')
    expect(getPreUpload('newImages', 'products', file)).toBe(pre)
  })

  it('signs the URLs of images chosen together with one server call', async () => {
    const { deps, openAll } = makeDeps()
    const files = [photo('1.webp'), photo('2.webp'), photo('3.webp')]
    const pres = files.map((f) => startPreUpload(f, 'products', 'newImages', deps))
    await tick()
    expect(deps.requestBatch).toHaveBeenCalledTimes(1)
    expect(deps.requestBatch.mock.calls[0][0]).toHaveLength(3)
    openAll()
    expect((await Promise.all(pres.map((p) => p.promise))).sort()).toEqual(['products/k1.webp', 'products/k2.webp', 'products/k3.webp'])
  })

  it('choosing the same file again reuses the running upload', async () => {
    const { deps } = makeDeps()
    const file = photo('same.webp')
    const first = startPreUpload(file, 'products', 'newImages', deps)
    const second = startPreUpload(file, 'products', 'newImages', deps)
    expect(second).toBe(first)
    await tick()
    expect(deps.put).toHaveBeenCalledTimes(1)
  })
})

describe('save waits only for unfinished uploads', () => {
  it('uses finished and running uploads, and uploads only what was never started', async () => {
    const { deps, open, openAll } = makeDeps()
    const [a, b, c] = [photo('a.webp'), photo('b.webp'), photo('c.webp')]
    const preA = startPreUpload(a, 'products', 'newImages', deps)
    await tick()
    open(1) // A is done
    await preA.promise
    startPreUpload(b, 'products', 'newImages', deps) // B still uploading
    await tick()
    expect(deps.put).toHaveBeenCalledTimes(2)

    const form = formWith([a, b, c]) // C was never pre-uploaded
    let settled = false
    const saving = uploadFormImages(form, fields, deps).then((keys) => ((settled = true), keys))
    await tick()
    expect(settled).toBe(false) // waits for B (and C)
    // A and B were not uploaded again; only C started a new upload
    expect(deps.put).toHaveBeenCalledTimes(3)
    expect(deps.prepare).toHaveBeenCalledTimes(3)
    openAll()
    const keys = await saving
    expect(keys).toEqual(['products/k1.webp', 'products/k2.webp', 'products/k3.webp'])
    expect(form.get('newImageKeys')).toBe(JSON.stringify(keys))
    expect(form.getAll('newImages')).toEqual([]) // raw files never reach the server
  })

  it('a finished pre-upload makes the save instant: no network at all', async () => {
    const { deps, openAll } = makeDeps()
    const files = [photo('x.webp'), photo('y.webp')]
    files.forEach((f) => startPreUpload(f, 'products', 'newImages', deps))
    await tick()
    openAll()
    await tick()
    deps.put.mockClear()
    deps.prepare.mockClear()
    deps.requestBatch.mockClear()
    const keys = await uploadFormImages(formWith(files), fields, deps)
    expect(keys).toHaveLength(2)
    expect(deps.put).not.toHaveBeenCalled()
    expect(deps.prepare).not.toHaveBeenCalled()
    expect(deps.requestBatch).not.toHaveBeenCalled()
  })

  it('a failed pre-upload falls back to the normal upload at save time', async () => {
    const { deps, openAll } = makeDeps()
    deps.put.mockImplementationOnce(async () => {
      throw new Error('network down')
    })
    const file = photo('flaky.webp')
    const pre = startPreUpload(file, 'products', 'newImages', deps)
    await expect(pre.promise).rejects.toThrow('network down')
    await tick()
    expect(pre.state).toBe('error')
    expect(getPreUpload('newImages', 'products', file)).toBeUndefined() // failed entries are never reused

    const saving = uploadFormImages(formWith([file]), fields, deps)
    await tick()
    openAll()
    expect(await saving).toHaveLength(1)
    expect(deps.put).toHaveBeenCalledTimes(2) // the failed attempt + the save-time upload
  })

  it('a retry after a failed save reuses the same key; a new form never reuses a saved key', async () => {
    const { deps, openAll } = makeDeps()
    const file = photo('retry.webp')
    const pre = startPreUpload(file, 'products', 'newImages', deps)
    await tick()
    openAll()
    const first = await uploadFormImages(formWith([file]), fields, deps) // the save itself then failed (network)
    const retry = await uploadFormImages(formWith([file]), fields, deps) // admin presses save again
    expect(retry).toEqual(first)
    expect(deps.put).toHaveBeenCalledTimes(1)

    releasePreUpload(pre) // the form was closed after a successful save
    const again = startPreUpload(file, 'products', 'newImages', deps) // the same photo chosen in another form
    await tick()
    openAll()
    expect(await again.promise).not.toBe(first[0])
  })

  it('two fields holding the same photo get different keys', async () => {
    const { deps, openAll } = makeDeps()
    const file = photo('both.webp')
    const main = startPreUpload(file, 'products', 'image', deps)
    const extra = startPreUpload(file, 'products', 'newImages', deps)
    await tick()
    openAll()
    expect(await main.promise).not.toBe(await extra.promise)
  })
})

describe('discarding what was never saved', () => {
  it('replacing or removing a chosen image deletes its object once uploaded', async () => {
    const discard = vi.fn(async () => {})
    setDiscardHandler(discard)
    const { deps, openAll } = makeDeps()
    const pre = startPreUpload(photo('old.webp'), 'products', 'image', deps)
    await tick()
    discardPreUpload(pre) // still uploading: waits for it to finish, then deletes
    expect(discard).not.toHaveBeenCalled()
    openAll()
    await pre.promise
    await tick()
    expect(discard).toHaveBeenCalledTimes(1)
    expect(discard).toHaveBeenCalledWith(['products/k1.webp'])
    expect(getPreUpload('image', 'products', pre.file)).toBeUndefined()
  })

  it('closing the form discards unsaved uploads but never one that was sent for saving', async () => {
    const discard = vi.fn(async () => {})
    setDiscardHandler(discard)
    const { deps, openAll } = makeDeps()
    const used = photo('used.webp')
    const unused = photo('unused.webp')
    const preUsed = startPreUpload(used, 'products', 'newImages', deps)
    const preUnused = startPreUpload(unused, 'products', 'newImages', deps)
    await tick()
    openAll()
    await uploadFormImages(formWith([used]), fields, deps) // only `used` went into a save
    releasePreUpload(preUsed)
    releasePreUpload(preUnused)
    await tick()
    expect(discard).toHaveBeenCalledTimes(1)
    expect(discard).toHaveBeenCalledWith([await preUnused.promise])
  })

  it('discards of one moment are sent together', async () => {
    const discard = vi.fn(async () => {})
    setDiscardHandler(discard)
    const { deps, openAll } = makeDeps()
    const pres = [photo('1.webp'), photo('2.webp'), photo('3.webp')].map((f) => startPreUpload(f, 'products', 'newImages', deps))
    await tick()
    openAll()
    await Promise.all(pres.map((p) => p.promise))
    pres.forEach((p) => releasePreUpload(p))
    await tick()
    expect(discard).toHaveBeenCalledTimes(1)
    expect((discard.mock.calls[0] as unknown as string[][])[0]).toHaveLength(3)
  })

  it('a pre-upload that fails after its URL was signed releases that key at once', async () => {
    const discard = vi.fn(async () => {})
    setDiscardHandler(discard)
    const { deps } = makeDeps()
    deps.put.mockImplementationOnce(async () => {
      throw new Error('network down')
    })
    const pre = startPreUpload(photo('lost.webp'), 'products', 'image', deps)
    await expect(pre.promise).rejects.toThrow('network down')
    await tick()
    expect(discard).toHaveBeenCalledTimes(1)
    expect(discard).toHaveBeenCalledWith(['products/k1.webp']) // the key that was signed but never uploaded
  })

  it('a failed discard call is silent (the daily cleanup catches the rest)', async () => {
    setDiscardHandler(async () => {
      throw new Error('server down')
    })
    const { deps, openAll } = makeDeps()
    const pre = startPreUpload(photo('z.webp'), 'products', 'image', deps)
    await tick()
    openAll()
    await pre.promise
    expect(() => discardPreUpload(pre)).not.toThrow()
    await tick()
  })
})

describe('validation at selection', () => {
  it('rejects a file type the server would refuse, and the save then reports the same problem', async () => {
    const { deps } = makeDeps()
    const pdf = new File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf', lastModified: 1 })
    const pre = startPreUpload(pdf, 'products', 'image', deps)
    await expect(pre.promise).rejects.toThrow('نوع الصورة غير مدعوم')
    expect(deps.put).not.toHaveBeenCalled()
  })
})
