import type { ImageFolder } from "./keys"

// سجل الصور المرفوعة مسبقاً في المتصفح: حالة فقط، بلا منطق رفع (المنطق في upload-client.ts).
//
// الفكرة: حين يختار المدير صورة يبدأ ضغطها ورفعها فوراً، فعند «حفظ» يجد النموذج مفتاحها جاهزاً (أو ينتظر ما لم يكتمل).
// - الإدخال يخص حقلاً بعينه (اسمه + مجلده + الملف)، فلا تأخذ صورتان في حقلين المفتاح نفسه (حذف إحداهما لا يمسّ الأخرى).
// - بعد أن يستهلكه الحفظ (markSubmitted) يبقى في السجل ما دام حقله معروضاً، لتعيد المحاولة بعد فشل شبكة الحفظ نفس المفتاح
//   بدل رفع جديد. ويُسقَط من السجل حين يُزال الحقل (يُغلق النموذج)، فلا يُعاد استعمال مفتاح حفظ ناجح في نموذج آخر.
// - ما لم يُرسَل لحفظ ولا يُستعمل (استُبدلت الصورة أو أُغلق النموذج) يُلغى: يُحذف كائنه من R2 عبر الخادم.

export type PreUploadState = "working" | "done" | "error"

export class PreUpload {
  state: PreUploadState = "working"
  key?: string
  error?: Error
  /** دخل في محاولة حفظ: لا يُلغى بعدها لأن الخادم قد يكون استعمل مفتاحه. */
  submitted = false
  discarded = false
  private listeners = new Set<() => void>()

  constructor(
    readonly signature: string,
    readonly file: File,
    readonly folder: ImageFolder,
    /** يُحَلّ بالمفتاح عند اكتمال الرفع، ويُرفض عند فشله. */
    readonly promise: Promise<string>,
  ) {
    // الرفض يُعالَج عند من ينتظر المفتاح (الحفظ يعود للرفع العادي)؛ لا نترك رفضاً بلا معالج.
    promise.then(
      (key) => this.settle("done", key),
      (error) => this.settle("error", undefined, error instanceof Error ? error : new Error(String(error))),
    )
  }

  private settle(state: PreUploadState, key?: string, error?: Error) {
    this.state = state
    this.key = key
    this.error = error
    for (const listener of this.listeners) listener()
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
}

const entries = new Map<string, PreUpload>()

/** هوية إدخال: اسم الحقل في النموذج + المجلد + الملف (الاسم والحجم ووقت التعديل). */
export function preUploadSignature(fieldName: string, folder: ImageFolder, file: File): string {
  return `${fieldName}|${folder}|${file.name}|${file.size}|${file.lastModified}`
}

export function registerPreUpload(pre: PreUpload): void {
  entries.set(pre.signature, pre)
}

/** الإدخال القابل للاستعمال لملف في حقل: قيد الرفع أو مكتمل. الفاشل أو الملغى لا يُعاد استعماله. */
export function getPreUpload(fieldName: string, folder: ImageFolder, file: File): PreUpload | undefined {
  const pre = entries.get(preUploadSignature(fieldName, folder, file))
  return pre && !pre.discarded && pre.state !== "error" ? pre : undefined
}

export function markSubmitted(pre: PreUpload): void {
  pre.submitted = true
}

// ---------- الإلغاء: حذف كائنات لم يستعملها أي حفظ ----------

type DiscardHandler = (keys: string[]) => Promise<unknown>

async function defaultDiscard(keys: string[]): Promise<unknown> {
  const { discardUploads } = await import("@/app/manage/client-actions")
  return discardUploads(keys)
}

let discardHandler: DiscardHandler = defaultDiscard
let queued: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | undefined

/** للاختبار: يبدّل نداء الإلغاء (ويعيد الأصلي). */
export function setDiscardHandler(handler: DiscardHandler | null): void {
  discardHandler = handler ?? defaultDiscard
}

/** إلغاءات الحدث نفسه (نموذج فيه عدة صور يُغلق) تُرسل بنداء واحد. فشل الإلغاء لا يزعج المدير: التنظيف اليومي يلتقط الباقي. */
function queueDiscard(key: string) {
  queued.push(key)
  flushTimer ??= setTimeout(() => {
    const keys = queued
    queued = []
    flushTimer = undefined
    void discardHandler(keys).catch(() => {})
  }, 0)
}

/** يلغي مفتاحاً وُقّع رابطه ولم يُحفظ في أي إدخال (فشل رفعه بعد التوقيع): لا كائن له، فيُزال سجله المعلّق. */
export function discardObjectKey(key: string): void {
  queueDiscard(key)
}

/** يلغي إدخالاً لم يُرسَل لحفظ: يخرج من السجل ويُحذف كائنه حين يكتمل رفعه. لا أثر لما أُرسل لحفظ. */
export function discardPreUpload(pre: PreUpload | null | undefined): void {
  if (!pre || pre.submitted || pre.discarded) return
  pre.discarded = true
  if (entries.get(pre.signature) === pre) entries.delete(pre.signature)
  // قيد الرفع: ننتظر ليكتمل ثم نحذفه (لا يمكن سحب PUT جارٍ بأمان). فاشل: لا كائن.
  pre.promise.then((key) => queueDiscard(key), () => {})
}

/** حقله أُزيل من الصفحة: يخرج من السجل، ويُلغى إن لم يُرسَل لحفظ. */
export function releasePreUpload(pre: PreUpload | null | undefined): void {
  if (!pre) return
  if (entries.get(pre.signature) === pre) entries.delete(pre.signature)
  discardPreUpload(pre)
}

/** للاختبار. */
export function resetPreUploads(): void {
  entries.clear()
  queued = []
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = undefined
}
