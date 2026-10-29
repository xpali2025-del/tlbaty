import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { putWithRetry, waitUntilOnline } from '@/lib/storage/put'
import { uploadConcurrency } from '@/lib/storage/upload-transport'
const file = new File(['data'], 'video.mp4', { type: 'video/mp4' })
let responses: (number | 'network' | 'timeout' | 'hang')[]
let instances: FakeXHR[]
class FakeXHR {
  status = 0; timeout = 0; url = ''; headers: Record<string, string> = {}
  upload = { onprogress: null as null | ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) }
  onload: null | (() => void) = null; onerror: null | (() => void) = null; ontimeout: null | (() => void) = null; onabort: null | (() => void) = null
  constructor() { instances.push(this) }
  open(_: string, url: string) { this.url = url }
  setRequestHeader(key: string, value: string) { this.headers[key] = value }
  abort() { this.onabort?.() }
  send() {
    const result = responses.shift() ?? 200
    this.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 })
    if (result === 'network') this.onerror?.()
    else if (result === 'timeout') this.ontimeout?.()
    else if (result !== 'hang') { this.status = result; this.onload?.() }
  }
}
beforeEach(() => {
  responses = []; instances = []; vi.useFakeTimers()
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ type: 'opaque' }))
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('putWithRetry', () => {
  it('sends signed headers and reports progress', async () => {
    const progress = vi.fn()
    await putWithRetry('https://storage/secret', file, { onProgress: progress })
    expect(instances[0].headers).toEqual({ 'Content-Type': 'video/mp4', 'Cache-Control': 'public, max-age=31536000, immutable' })
    expect(progress).toHaveBeenLastCalledWith(1)
    expect(instances[0].timeout).toBe(21000)
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('secret')
  })
  it.each(['network', 'timeout', 408, 429, 503] as const)('retries %s', async status => {
    responses = [status, 200]
    const timeout = vi.fn()
    const task = putWithRetry('https://storage/a', file, { onTimeout: timeout })
    await vi.runAllTimersAsync(); await task
    expect(instances).toHaveLength(2)
    expect(timeout).toHaveBeenCalledTimes(status === 'timeout' ? 1 : 0)
  })
  it('renews a 403 only once', async () => {
    responses = [403, 403]
    const resign = vi.fn().mockResolvedValue('https://storage/new')
    await expect(putWithRetry('https://storage/old', file, { resign })).rejects.toMatchObject({ status: 403 })
    expect(resign).toHaveBeenCalledTimes(1)
    expect(instances.map(i => i.url)).toEqual(['https://storage/old', 'https://storage/new'])
  })
  it('fails fast on 400', async () => {
    responses = [400]
    await expect(putWithRetry('https://storage/a', file)).rejects.toMatchObject({ status: 400 })
    expect(instances).toHaveLength(1)
  })
  it.each([true, false])('diagnoses exhausted retries, reachable=%s', async reachable => {
    responses = Array(5).fill('network')
    if (!reachable) vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    const task = expect(putWithRetry('https://storage/a', file)).rejects.toMatchObject({ kind: reachable ? 'blocked' : 'unreachable', message: expect.stringMatching(/[\u0600-\u06ff]/) })
    await vi.runAllTimersAsync(); await task
    expect(instances).toHaveLength(5)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('waits for online without consuming attempts', async () => {
    const nav = { onLine: false }; const window = new EventTarget()
    vi.stubGlobal('navigator', nav); vi.stubGlobal('window', window)
    const task = putWithRetry('https://storage/a', file)
    expect(instances).toHaveLength(0)
    nav.onLine = true; window.dispatchEvent(new Event('online'))
    await task; expect(instances).toHaveLength(1)
  })
  it('times out offline waiting', async () => {
    vi.stubGlobal('navigator', { onLine: false }); vi.stubGlobal('window', new EventTarget())
    const task = expect(waitUntilOnline()).rejects.toMatchObject({ kind: 'offline' })
    await vi.runAllTimersAsync(); await task
  })
  it('cancels an active PUT without retrying', async () => {
    responses = ['hang']; const controller = new AbortController()
    const task = expect(putWithRetry('https://storage/a', file, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve(); controller.abort(); await task
    expect(instances).toHaveLength(1)
  })
  it('cancels offline waiting', async () => {
    vi.stubGlobal('navigator', { onLine: false }); vi.stubGlobal('window', new EventTarget())
    const controller = new AbortController()
    const task = expect(waitUntilOnline(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await task
  })
})
describe('connection-aware concurrency', () => {
  it.each([[undefined, 3], [{ effectiveType: '2g' }, 1], [{ effectiveType: '3g' }, 2], [{ effectiveType: '4g' }, 4], [{ saveData: true }, 1]])('selects %j', (connection, count) => {
    vi.stubGlobal('navigator', { connection }); expect(uploadConcurrency()).toBe(count)
  })
})
