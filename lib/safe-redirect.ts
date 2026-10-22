/**
 * مسار داخلي آمن لإعادة التوجيه بعد الدخول. يرفض كل ما قد يفسّره المتصفح كعنوان خارجي:
 * `//host` و`/\\host` (المتصفحات تحوّل \\ إلى /) وأي محارف تحكم (tab/newline تُحذف عند التحليل).
 * التحقق النهائي بتحليل URL: يجب أن يبقى على المصدر نفسه.
 */
export function safeInternalPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback
  try {
    return new URL(value, "http://internal.invalid").origin === "http://internal.invalid" ? value : fallback
  } catch {
    return fallback
  }
}
