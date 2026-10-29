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

  it('aborts stalled attempts using the size-scaled timeout and clears timers', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_url: string, { signal }: { signal: AbortSignal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const onTimeout = vi.fn()
    const pending = putImage('https://storage/upload', file(), { onTimeout })
    const result = pending.catch(error => error)
    await vi.advanceTimersByTimeAsync(16_999)
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
