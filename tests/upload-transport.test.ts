import { afterEach, describe, expect, it, vi } from 'vitest'
import { putImage, uploadConcurrency, waitUntilOnline } from '@/lib/storage/upload-transport'
import { uploadFormImages } from '@/lib/storage/upload-client'

const file = () => new File([new Uint8Array(80_000)], 'photo.png', { type: 'image/png' })

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function settle(promise: Promise<unknown>) {
  const result = promise.then(() => null, (error: Error) => error)
  await vi.runAllTimersAsync()
  return result
}

describe('bounded image transport', () => {
  it.each([408, 429, 500, 503])('retries transient HTTP %i on the same URL', async (status) => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, status }).mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetcher)
    expect(await settle(putImage('https://storage/upload', file()))).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://storage/upload', 'https://storage/upload'])
    expect(fetcher.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'image/png' })
  })

  it.each([400, 401, 403, 404])('does not blindly retry permanent HTTP %i', async (status) => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status })
    vi.stubGlobal('fetch', fetcher)
    await expect(putImage('https://storage/upload', file())).rejects.toMatchObject({ kind: 'http', status })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('limits network failures to five attempts without claiming a proven CORS cause', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetcher)
    expect(await settle(putImage('https://storage/upload', file()))).toMatchObject({ kind: 'network' })
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds fetch fallback attempts at two minutes and clears timers', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_url: string, { signal }: { signal: AbortSignal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const onTimeout = vi.fn()
    const pending = putImage('https://storage/upload', file(), { onTimeout })
    const result = pending.catch(error => error)
    await vi.advanceTimersByTimeAsync(119_999)
    expect(onTimeout).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ kind: 'timeout' })
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for connectivity without spending PUT attempts and removes listeners', async () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const remove = vi.spyOn(target, 'removeEventListener')
    const navigator = { onLine: false }
    vi.stubGlobal('window', target)
    vi.stubGlobal('navigator', navigator)
    const fetcher = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetcher)
    const pending = putImage('https://storage/upload', file())
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetcher).not.toHaveBeenCalled()
    navigator.onLine = true
    target.dispatchEvent(new Event('online'))
    await pending
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('online', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ends offline waiting after two minutes without claiming automatic continuation', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('navigator', { onLine: false })
    expect(await settle(waitUntilOnline())).toMatchObject({ kind: 'offline' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([[undefined, 3], [{ effectiveType: 'slow-2g' }, 1], [{ effectiveType: '2g' }, 1], [{ effectiveType: '3g' }, 2], [{ effectiveType: '4g' }, 4], [{ effectiveType: '4g', saveData: true }, 1]])('adapts to connection %j', (connection, expected) => {
    vi.stubGlobal('navigator', { connection })
    expect(uploadConcurrency()).toBe(expected)
  })
})

describe('upload scheduling safeguards', () => {
  const fields = [{ name: 'images', keyName: 'keys', folder: 'products' as const, multiple: true }]
  it('does not sign later waves before current uploads finish and backs off after timeout', async () => {
    vi.stubGlobal('navigator', { onLine: true, connection: { effectiveType: '4g' } })
    const form = new FormData()
    for (let i = 0; i < 7; i++) form.append('images', file())
    const sizes: number[] = []
    let puts = 0
    await uploadFormImages(form, fields, {
      request: vi.fn(),
      requestBatch: async items => {
        expect(puts).toBe(sizes.reduce((a, b) => a + b, 0))
        sizes.push(items.length)
        return items.map(() => ({ uploadUrl: 'https://storage/upload', objectKey: 'products/key.png' }))
      },
      put: async (_url, _file, options) => { if (puts++ === 0) options?.onTimeout?.() },
    })
    expect(sizes).toEqual([4, 2, 1])
  })

  it('rejects a large uncompressed fallback before requesting any URL', async () => {
    const form = new FormData()
    form.append('images', new File([new Uint8Array(2_000_000)], 'large.png', { type: 'image/png' }))
    const request = vi.fn()
    await expect(uploadFormImages(form, fields, { request, prepare: async file => file, put: vi.fn() })).rejects.toThrow('تعذّر ضغط الصورة')
    expect(request).not.toHaveBeenCalled()
    expect(form.has('keys')).toBe(false)
  })
})

describe('browser upload progress', () => {
  function xhrBrowser() {
    const instances: FakeXHR[] = []
    class FakeXHR {
      status = 0
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      upload = { onprogress: null as ((event: { loaded: number }) => void) | null }
      open = vi.fn()
      setRequestHeader = vi.fn()
      send = vi.fn()
      abort = vi.fn(() => this.onabort?.())
      constructor() { instances.push(this) }
      progress(loaded: number) { this.upload.onprogress?.({ loaded }) }
      respond(status: number) { this.status = status; this.onload?.() }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    return instances
  }

  it('allows a slow progressing transfer beyond the old deadline and waits for HTTP success', async () => {
    vi.useFakeTimers()
    const instances = xhrBrowser()
    const onTimeout = vi.fn()
    let done = false
    const image = file()
    const pending = putImage('https://storage/signed', image, { onTimeout }).then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    const xhr = instances[0]
    expect(xhr.open).toHaveBeenCalledWith('PUT', 'https://storage/signed')
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'image/png')
    expect(xhr.send).toHaveBeenCalledWith(image)
    await vi.advanceTimersByTimeAsync(40_000)
    xhr.progress(40_000)
    await vi.advanceTimersByTimeAsync(40_000)
    xhr.progress(80_000)
    expect(done).toBe(false) // 100% bytes sent is not a confirmed object write
    expect(onTimeout).not.toHaveBeenCalled()
    xhr.respond(200)
    await pending
    expect(instances).toHaveLength(1)
    expect(xhr.upload.onprogress).toBeNull()
    expect(xhr.onload).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not treat repeated progress counts as new bytes and bounds stalled retries', async () => {
    vi.useFakeTimers()
    const instances = xhrBrowser()
    const onTimeout = vi.fn()
    const pending = putImage('https://storage/signed', file(), { onTimeout }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    instances[0].progress(1)
    await vi.advanceTimersByTimeAsync(40_000)
    instances[0].progress(1)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(onTimeout).toHaveBeenCalledOnce()
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ kind: 'timeout' })
    expect(instances).toHaveLength(5)
    expect(instances.every((x) => x.upload.onprogress === null)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('enforces an overall two-minute attempt cap even with continuing progress', async () => {
    vi.useFakeTimers()
    const instances = xhrBrowser()
    const onTimeout = vi.fn()
    const pending = putImage('https://storage/signed', file(), { onTimeout }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 1; i <= 3; i++) {
      await vi.advanceTimersByTimeAsync(30_000)
      instances[0].progress(i * 10_000)
    }
    await vi.advanceTimersByTimeAsync(30_000)
    expect(onTimeout).toHaveBeenCalledOnce()
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ kind: 'timeout' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a storage rejection as HTTP failure without retrying it as a connection loss', async () => {
    vi.useFakeTimers()
    const instances = xhrBrowser()
    const pending = putImage('https://storage/signed', file()).catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    instances[0].respond(403)
    expect(await pending).toMatchObject({ kind: 'http', status: 403 })
    expect(instances).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries transient browser network errors on the same signed URL and succeeds', async () => {
    vi.useFakeTimers()
    const instances = xhrBrowser()
    const pending = putImage('https://storage/signed', file())
    await vi.advanceTimersByTimeAsync(0)
    instances[0].onerror?.()
    await vi.advanceTimersByTimeAsync(1000)
    expect(instances).toHaveLength(2)
    instances[1].respond(200)
    await pending
    expect(instances.every((x) => x.open.mock.calls[0][1] === 'https://storage/signed')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
