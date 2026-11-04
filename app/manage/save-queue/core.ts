// نواة طابور الحفظ: بلا React ولا متصفح، فتُختبر بمؤقتات وتخزين وهميين.
//
// يضيف المدير عملية حفظ فتُغلق النافذة فوراً وتبقى العملية هنا إلى أن تنجح:
// - عمليات العنصر الواحد بالترتيب، وعناصر مختلفة بالتوازي (حتى 3).
// - الخطأ المؤقت (شبكة، 5xx، مهلة) يُعاد بتباعد 1 ثم 2 ثم 4 ثم 8 ثم 16 ثانية، ثم تنتظر العملية عودة الاتصال أو ضغطة المدير.
//   إعادة الإرسال آمنة لأن requestId ثابت في كل المحاولات (الخادم يعيد النتيجة المحفوظة ولا يكرّر).
// - الرفض (تحقق، صلاحية) والتعارض لا يُعادان تلقائياً: يُعرضان على المدير والعملية محفوظة كاملة.
// - كل تغيّر في الحالة يُكتب في التخزين الدائم (IndexedDB) فتستمر العمليات بعد تحديث الصفحة أو انقطاع الإنترنت.

export type JobState = "queued" | "running" | "retrying" | "failed" | "conflict"

export type JobEntry = [name: string, value: string | File]

export type SaveJob<T = unknown> = {
  id: string
  screen: string
  /** معرّف العنصر المحفوظ (أو معرّف مؤقت لعنصر جديد لم يُحفظ بعد). */
  entityId: string
  label: string
  /** معرّف العملية عند الخادم: ثابت في كل إعادة محاولة. */
  requestId: string
  /** حقول النموذج كما أُرسلت (النصوص والملفات)، لإعادة بنائه كاملاً عند التنفيذ بعد تحديث الصفحة. */
  entries: JobEntry[]
  /** شكل العنصر كما يظهر في القائمة حتى يصل رد الخادم. */
  optimistic: T
  state: JobState
  attempts: number
  /** آخر خطأ، ليراه المدير على العنصر الأحمر. */
  error?: string
  /** الفشل سببه الاتصال (يُستأنف تلقائياً عند عودته). */
  offline?: boolean
  /** وقت المحاولة التالية حين تكون الحالة retrying. */
  nextRetryAt?: number
  /** نسخة الخادم الحالية حين تكون الحالة conflict (قد تكون null إن حُذف العنصر). */
  conflict?: T | null
  createdAt: number
}

export type ExecResult<T> = { status: "saved"; item: T } | { status: "conflict"; current: T | null }

export type ScreenExecutor<T = unknown> = {
  execute: (job: SaveJob<T>) => Promise<ExecResult<T>>
  /** بعد نجاح الحفظ: ينقل العمليات اللاحقة لنفس العنصر إلى نسخته الجديدة (وإلا ظهر تعارض كاذب). */
  rebase?: (job: SaveJob<T>, saved: T) => SaveJob<T>
  /** نجح الحفظ: تُدرَج نسخة الخادم في القائمة. */
  onSaved: (job: SaveJob<T>, saved: T) => void
}

export interface JobStore {
  load(): Promise<SaveJob[]>
  put(job: SaveJob): Promise<void>
  remove(id: string): Promise<void>
}

export class MemoryJobStore implements JobStore {
  readonly jobs = new Map<string, SaveJob>()
  async load() {
    return [...this.jobs.values()].map((j) => ({ ...j }))
  }
  async put(job: SaveJob) {
    this.jobs.set(job.id, { ...job })
  }
  async remove(id: string) {
    this.jobs.delete(id)
  }
}

export type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  now: () => number
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000]
export const MAX_PARALLEL = 3

export type QueueOptions = {
  store: JobStore
  executors: Record<string, ScreenExecutor<unknown>>
  /** هل هذا الخطأ مؤقت (شبكة/خادم) فيُعاد، أم نهائي فيُعرض؟ */
  isTransient: (error: unknown) => boolean
  timers?: Timers
  backoff?: number[]
  maxParallel?: number
}

type Listener = () => void

export class SaveQueue {
  private jobs: SaveJob[] = []
  private snapshot: readonly SaveJob[] = []
  private listeners = new Set<Listener>()
  private timersById = new Map<string, unknown>()
  private running = new Set<string>()
  private timers: Timers
  private backoff: number[]
  private maxParallel: number
  private loaded: Promise<void> | null = null

  constructor(private options: QueueOptions) {
    this.timers = options.timers ?? realTimers
    this.backoff = options.backoff ?? BACKOFF_MS
    this.maxParallel = options.maxParallel ?? MAX_PARALLEL
  }

  // ---------- القراءة ----------

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  getSnapshot = (): readonly SaveJob[] => this.snapshot

  /** عمليات لم تنتهِ بعد (كل الحالات). */
  get active(): readonly SaveJob[] {
    return this.snapshot
  }

  private emit() {
    this.snapshot = this.jobs.map((j) => ({ ...j }))
    for (const listener of this.listeners) listener()
  }

  // ---------- الإضافة والاستئناف ----------

  /** يحمّل العمليات المحفوظة من جلسة سابقة (مرة واحدة) ويستأنفها. */
  resume(): Promise<void> {
    this.loaded ??= (async () => {
      const saved = await this.options.store.load()
      const known = new Set(this.jobs.map((j) => j.id))
      for (const job of saved.sort((a, b) => a.createdAt - b.createdAt)) {
        if (known.has(job.id)) continue
        // ما كان يعمل أو ينتظر محاولة عند إغلاق الصفحة يعود للطابور. الفاشل بسبب الاتصال يُجرَّب ثانية. الرفض والتعارض يبقيان للمدير.
        const restart = job.state === "running" || job.state === "retrying" || (job.state === "failed" && job.offline)
        this.jobs.push(restart ? { ...job, state: "queued", attempts: 0, nextRetryAt: undefined } : job)
      }
      this.emit()
      this.pump()
    })()
    return this.loaded
  }

  enqueue(input: Omit<SaveJob, "state" | "attempts" | "createdAt"> & { createdAt?: number }): SaveJob {
    const job: SaveJob = { ...input, state: "queued", attempts: 0, createdAt: input.createdAt ?? this.timers.now() }
    this.jobs.push(job)
    void this.options.store.put(job)
    this.emit()
    this.pump()
    return job
  }

  // ---------- أفعال المدير ----------

  /** أعد المحاولة الآن (العملية الفاشلة أو المنتظرة). */
  retry(id: string) {
    const job = this.find(id)
    if (!job || job.state === "running" || job.state === "queued") return
    this.clearRetryTimer(id)
    this.update(id, { state: "queued", attempts: 0, error: undefined, offline: undefined, nextRetryAt: undefined, conflict: undefined })
    this.pump()
  }

  /** يعدّل عملية لم تبدأ أو فشلت (تعديل المدير لها، أو اختياره «احتفظ بتعديلي» بعد تعارض). */
  patch(id: string, changes: Partial<Omit<SaveJob, "id" | "screen">>) {
    const job = this.find(id)
    if (!job || job.state === "running") return
    this.update(id, changes)
  }

  /** يحذف العملية دون حفظ (المدير تخلّى عنها أو أخذ نسخة الخادم). */
  remove(id: string) {
    const job = this.find(id)
    if (!job || job.state === "running") return
    this.clearRetryTimer(id)
    this.jobs = this.jobs.filter((j) => j.id !== id)
    void this.options.store.remove(id)
    this.emit()
    this.pump()
  }

  /** عاد الاتصال: تُستأنف كل العملية المنتظرة بسببه فوراً. */
  online() {
    for (const job of this.jobs) {
      if (job.state === "retrying" || (job.state === "failed" && job.offline)) {
        this.clearRetryTimer(job.id)
        this.update(job.id, { state: "queued", attempts: 0, error: undefined, offline: undefined, nextRetryAt: undefined })
      }
    }
    this.pump()
  }

  // ---------- التنفيذ ----------

  private find(id: string) {
    return this.jobs.find((j) => j.id === id)
  }

  private update(id: string, changes: Partial<SaveJob>) {
    const index = this.jobs.findIndex((j) => j.id === id)
    if (index < 0) return
    this.jobs[index] = { ...this.jobs[index], ...changes }
    void this.options.store.put(this.jobs[index])
    this.emit()
  }

  private clearRetryTimer(id: string) {
    const handle = this.timersById.get(id)
    if (handle !== undefined) this.timers.clearTimeout(handle)
    this.timersById.delete(id)
  }

  /** تبدأ ما يمكن بدؤه: عملية لا يسبقها شيء لنفس العنصر، وبحد أقصى للتوازي. */
  private pump() {
    for (const job of this.jobs) {
      if (this.running.size >= this.maxParallel) return
      if (job.state !== "queued" || this.running.has(job.id)) continue
      const blocked = this.jobs.some((other) => other !== job && other.entityId === job.entityId && other.screen === job.screen && this.jobs.indexOf(other) < this.jobs.indexOf(job))
      if (blocked) continue
      void this.run(job.id)
    }
  }

  private async run(id: string) {
    const job = this.find(id)
    if (!job) return
    const executor = this.options.executors[job.screen]
    this.running.add(id)
    this.update(id, { state: "running", error: undefined })
    try {
      if (!executor) throw new Error(`لا منفّذ لشاشة ${job.screen}`)
      const result = await executor.execute(this.find(id) ?? job)
      if (result.status === "saved") {
        this.finish(id, executor, result.item)
        return
      }
      this.update(id, { state: "conflict", conflict: result.current, error: undefined })
    } catch (error) {
      this.fail(id, error)
    } finally {
      this.running.delete(id)
      this.pump()
    }
  }

  private finish(id: string, executor: ScreenExecutor<unknown>, saved: unknown) {
    const job = this.find(id)
    if (!job) return
    // العمليات اللاحقة لنفس العنصر بُنيت فوق النسخة المتفائلة، فتنتقل إلى نسخة الخادم المحفوظة.
    if (executor.rebase) {
      this.jobs = this.jobs.map((other) => {
        if (other.id === id || other.screen !== job.screen || other.entityId !== job.entityId) return other
        const rebased = executor.rebase!(other, saved)
        void this.options.store.put(rebased)
        return rebased
      })
    }
    this.jobs = this.jobs.filter((j) => j.id !== id)
    void this.options.store.remove(id)
    executor.onSaved(job, saved)
    this.emit()
  }

  private fail(id: string, error: unknown) {
    const job = this.find(id)
    if (!job) return
    const message = error instanceof Error ? error.message : "تعذّر الحفظ"
    if (!this.options.isTransient(error)) {
      this.update(id, { state: "failed", error: message, offline: false })
      return
    }
    const attempts = job.attempts + 1
    if (attempts > this.backoff.length) {
      // استُنفد التباعد: تنتظر العملية عودة الاتصال أو ضغطة «أعد المحاولة».
      this.update(id, { state: "failed", attempts, error: message, offline: true })
      return
    }
    const delay = this.backoff[attempts - 1]
    this.update(id, { state: "retrying", attempts, error: message, nextRetryAt: this.timers.now() + delay })
    this.timersById.set(
      id,
      this.timers.setTimeout(() => {
        this.timersById.delete(id)
        if (this.find(id)?.state === "retrying") {
          this.update(id, { state: "queued" })
          this.pump()
        }
      }, delay),
    )
  }
}
