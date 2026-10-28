// نتيجة فشل متوقعة يعيدها إجراء الخادم كقيمة بدل رمي خطأ: Next.js يُخفي نص الأخطاء المرمية في الإنتاج
// (فيرى المدير "Minified React error #441" بدل السبب). التوثيق الرسمي: الأخطاء المتوقعة تُعاد كقيم.
// هذا الملف بلا اعتماد على الخادم: يُستعمل في الواجهة لفك النتيجة وإعادة رمي الخطأ برسالته.

export type ActionFailure = { readonly __actionError: string }

export function isActionFailure(value: unknown): value is ActionFailure {
  return typeof value === "object" && value !== null && typeof (value as ActionFailure).__actionError === "string"
}

/** يعيد النتيجة، أو يرمي خطأً (في المتصفح) يحمل رسالة الخادم عند الفشل. */
export function unwrapAction<R>(result: R | ActionFailure): R {
  if (isActionFailure(result)) throw new Error(result.__actionError)
  return result
}

type Unwrapped<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<Exclude<R, ActionFailure>> : T[K]
}

/** يغلّف كل دوال الوحدة فتعيد النتيجة أو ترمي برسالة الخادم — بنفس الأسماء والتواقيع للواجهة. */
export function unwrapAll<T extends object>(mod: T): Unwrapped<T> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(mod)) {
    out[key] =
      typeof value === "function"
        ? async (...args: unknown[]) => unwrapAction(await (value as (...a: unknown[]) => Promise<unknown>)(...args))
        : value
  }
  return out as Unwrapped<T>
}
