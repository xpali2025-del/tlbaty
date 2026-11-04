import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryJobStore, SaveQueue, type ExecResult, type SaveJob, type ScreenExecutor } from '@/app/manage/save-queue/core'

// طابور الحفظ: الترتيب والتوازي وإعادة المحاولة والتعارض والاستئناف بعد إعادة التحميل.

type Item = { id: string; version: number; name: string }

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

let n = 0
const input = (over: Partial<SaveJob<Item>> = {}) => ({
  id: `job${++n}`,
  screen: 'products',
  entityId: `e${n}`,
  label: 'منتج',
  requestId: `req${n}`,
  entries: [['name', 'x']] as SaveJob['entries'],
  optimistic: { id: 'e', version: 1, name: 'x' } as Item,
  ...over,
})

function setup(execute: (job: SaveJob<Item>) => Promise<ExecResult<Item>>, store = new MemoryJobStore()) {
  const saved: Item[] = []
  const executor: ScreenExecutor<Item> = {
    execute,
    onSaved: (_job, item) => void (item && saved.push(item)),
    rebase: (job, item) => ({ ...job, entries: job.entries.map(([k, v]) => (k === 'expectedVersion' ? [k, String(item.version)] : [k, v])) as SaveJob['entries'] }),
  }
  const isTransient = (e: unknown) => e instanceof TypeError || (e instanceof Error && e.message === 'transient')
  const queue = new SaveQueue({ store, executors: { products: executor as ScreenExecutor<unknown> }, isTransient })
  return { queue, saved, store }
}

const ok = (id = 'e', version = 2, name = 'x'): ExecResult<Item> => ({ status: 'saved', item: { id, version, name } })
const state = (queue: SaveQueue, id: string) => queue.getSnapshot().find((j) => j.id === id)?.state

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('save queue: running', () => {
  it('saves, hands the server item to the screen, and forgets the job', async () => {
    const { queue, saved, store } = setup(async () => ok('e1', 5))
    queue.enqueue(input())
    await flush()
    expect(saved).toEqual([{ id: 'e1', version: 5, name: 'x' }])
    expect(queue.getSnapshot()).toHaveLength(0)
    expect(store.jobs.size).toBe(0)
  })

  it('persists the job before it runs, so a reload cannot lose it', async () => {
    const { queue, store } = setup(() => new Promise(() => {}))
    const job = queue.enqueue(input())
    expect(store.jobs.has(job.id)).toBe(true)
  })

  it('runs operations on one item in order, and different items in parallel up to 3', async () => {
    const gates = new Map<string, () => void>()
    const order: string[] = []
    const { queue } = setup((job) => new Promise((resolve) => {
      order.push(job.id)
      gates.set(job.id, () => resolve(ok(job.entityId)))
    }))
    const a1 = queue.enqueue(input({ entityId: 'A' }))
    const a2 = queue.enqueue(input({ entityId: 'A' }))
    const b = queue.enqueue(input({ entityId: 'B' }))
    const c = queue.enqueue(input({ entityId: 'C' }))
    const d = queue.enqueue(input({ entityId: 'D' }))
    await flush()
    expect(order).toEqual([a1.id, b.id, c.id]) // a2 waits for a1; d waits for a free slot
    expect(state(queue, a2.id)).toBe('queued')
    expect(state(queue, d.id)).toBe('queued')
    gates.get(a1.id)!()
    await flush()
    expect(order).toContain(a2.id)
    gates.get(b.id)!()
    await flush()
    expect(order).toContain(d.id)
  })

  it('moves the next operation on the same item onto the version that was just saved', async () => {
    const seen: string[] = []
    const { queue } = setup(async (job) => {
      seen.push(String(job.entries.find(([k]) => k === 'expectedVersion')?.[1]))
      return ok(job.entityId, seen.length + 1)
    })
    const entries: SaveJob['entries'] = [['expectedVersion', '1']]
    queue.enqueue(input({ entityId: 'A', entries }))
    queue.enqueue(input({ entityId: 'A', entries }))
    await flush()
    await flush()
    expect(seen).toEqual(['1', '2']) // the second would have been a false conflict on version 1
  })
})

describe('save queue: failures', () => {
  it('retries a connection failure after 1, 2, 4, 8, 16 seconds with the same request id, then saves once', async () => {
    const requestIds: string[] = []
    const times: number[] = []
    let calls = 0
    const { queue, saved } = setup(async (job) => {
      requestIds.push(job.requestId)
      times.push(Date.now())
      if (++calls <= 5) throw new TypeError('Failed to fetch')
      return ok(job.entityId)
    })
    const t0 = Date.now()
    const job = queue.enqueue(input({ requestId: 'same-id' }))
    await flush()
    expect(state(queue, job.id)).toBe('retrying')
    for (const wait of [1000, 2000, 4000, 8000, 16000]) {
      await vi.advanceTimersByTimeAsync(wait)
      await flush()
    }
    expect(times.map((t) => (t - t0) / 1000)).toEqual([0, 1, 3, 7, 15, 31])
    expect(new Set(requestIds)).toEqual(new Set(['same-id']))
    expect(saved).toHaveLength(1)
    expect(queue.getSnapshot()).toHaveLength(0)
  })

  it('after the schedule is spent it waits for the connection, then resumes when it returns', async () => {
    let up = false
    const { queue, saved } = setup(async (job) => {
      if (!up) throw new TypeError('Failed to fetch')
      return ok(job.entityId)
    })
    const job = queue.enqueue(input())
    await flush()
    for (const wait of [1000, 2000, 4000, 8000, 16000]) {
      await vi.advanceTimersByTimeAsync(wait)
      await flush()
    }
    const failed = queue.getSnapshot().find((j) => j.id === job.id)!
    expect(failed.state).toBe('failed')
    expect(failed.offline).toBe(true)
    up = true
    queue.online()
    await flush()
    expect(saved).toHaveLength(1)
  })

  it('does not retry a rejection: it is shown to the admin with the whole operation kept', async () => {
    const execute = vi.fn(async (): Promise<ExecResult<Item>> => {
      throw new Error('اسم المنتج مطلوب')
    })
    const { queue, store } = setup(execute)
    const job = queue.enqueue(input())
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(execute).toHaveBeenCalledTimes(1)
    const failed = queue.getSnapshot()[0]
    expect(failed).toMatchObject({ state: 'failed', error: 'اسم المنتج مطلوب', offline: false })
    expect(store.jobs.get(job.id)?.entries).toEqual(job.entries)
    // the admin presses retry: it runs again
    execute.mockResolvedValueOnce(ok())
    queue.retry(job.id)
    await flush()
    expect(queue.getSnapshot()).toHaveLength(0)
  })

  it('a conflict is not retried; keeping my edit re-sends it, taking theirs drops it', async () => {
    const results: ExecResult<Item>[] = [{ status: 'conflict', current: { id: 'e', version: 7, name: 'theirs' } }, ok('e', 8)]
    const execute = vi.fn(async () => results.shift()!)
    const { queue, saved } = setup(execute)
    const job = queue.enqueue(input())
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(queue.getSnapshot()[0]).toMatchObject({ state: 'conflict', conflict: { version: 7 } })
    queue.patch(job.id, { entries: [['expectedVersion', '7']], requestId: 'fresh' })
    queue.retry(job.id)
    await flush()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(saved).toHaveLength(1)

    const second = setup(async () => ({ status: 'conflict', current: null }))
    const other = second.queue.enqueue(input())
    await flush()
    second.queue.remove(other.id)
    expect(second.queue.getSnapshot()).toHaveLength(0)
  })
})

describe('save queue: screens that refresh their list from reloaded data', () => {
  const noItem = async (): Promise<ExecResult<Item>> => ({ status: 'saved' })

  it('keeps the saved job shown until the new data arrives, then drops it a moment later', async () => {
    const { queue, store } = setup(noItem)
    const job = queue.enqueue(input())
    await flush()
    expect(state(queue, job.id)).toBe('saved')
    expect(store.jobs.size).toBe(0) // nothing to resume after a reload: it is saved
    queue.notifyData('products')
    expect(state(queue, job.id)).toBe('saved')
    await vi.advanceTimersByTimeAsync(200)
    expect(queue.getSnapshot()).toHaveLength(0)
  })

  it('drops it right after saving when the data already arrived during the save', async () => {
    let release: () => void = () => {}
    const { queue } = setup(() => new Promise((resolve) => (release = () => resolve({ status: 'saved' }))))
    const job = queue.enqueue(input())
    await flush()
    queue.notifyData('products') // the reloaded page came back before the action reply
    release()
    await flush()
    expect(state(queue, job.id)).toBe('saved')
    await vi.advanceTimersByTimeAsync(200)
    expect(queue.getSnapshot()).toHaveLength(0)
  })

  it('does not wait forever if no data ever arrives', async () => {
    const { queue } = setup(noItem)
    queue.enqueue(input())
    await flush()
    await vi.advanceTimersByTimeAsync(4100)
    expect(queue.getSnapshot()).toHaveLength(0)
  })

  it('a saved job does not hold back the next save of the same item', async () => {
    const seen: string[] = []
    const { queue } = setup(async (j) => (seen.push(j.id), { status: 'saved' as const }))
    const a = queue.enqueue(input({ entityId: 'A' }))
    const b = queue.enqueue(input({ entityId: 'A' }))
    await flush()
    await flush()
    expect(seen).toEqual([a.id, b.id])
  })

  it('a screen without data of its own for another screen does not settle it', async () => {
    const { queue } = setup(noItem)
    const job = queue.enqueue(input())
    await flush()
    queue.notifyData('categories')
    await vi.advanceTimersByTimeAsync(300)
    expect(state(queue, job.id)).toBe('saved')
  })
})

describe('save queue: reload', () => {
  it('a job that was running when the page closed runs again with the same request id and saves once', async () => {
    const store = new MemoryJobStore()
    const first = setup(() => new Promise(() => {}), store) // never answers: the page is closed mid-save
    const job = first.queue.enqueue(input({ requestId: 'stable' }))
    await flush()
    expect(store.jobs.get(job.id)?.state).toBe('running')

    const seen: string[] = []
    const second = setup(async (j) => (seen.push(j.requestId), ok(j.entityId)), store) // the page opens again
    await second.queue.resume()
    await flush()
    expect(seen).toEqual(['stable'])
    expect(second.saved).toHaveLength(1)
    expect(store.jobs.size).toBe(0)
  })

  it('a rejected job stays red after a reload and is not sent again on its own', async () => {
    const store = new MemoryJobStore()
    const first = setup(async () => {
      throw new Error('السعر لا يمكن أن يكون سالباً')
    }, store)
    first.queue.enqueue(input())
    await flush()
    const execute = vi.fn(async (j: SaveJob<Item>) => ok(j.entityId))
    const second = setup(execute, store)
    await second.queue.resume()
    await flush()
    expect(execute).not.toHaveBeenCalled()
    expect(second.queue.getSnapshot()[0].state).toBe('failed')
  })

  it('resuming twice does not duplicate jobs', async () => {
    const store = new MemoryJobStore()
    await store.put({ ...input(), state: 'queued', attempts: 0, createdAt: 1 })
    const { queue, saved } = setup(async (j) => ok(j.entityId), store)
    await Promise.all([queue.resume(), queue.resume()])
    await flush()
    expect(saved).toHaveLength(1)
  })
})
