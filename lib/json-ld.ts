/**
 * يحوّل كائن JSON-LD إلى نص آمن للحقن داخل <script type="application/ld+json">.
 * JSON.stringify لا يهرّب "<"، فقيمة مثل «</script><script>…» (اسم متجر أو منتج من اللوحة)
 * تغلق الوسم وتنفّذ كوداً في كل صفحة. نهرّب < و> و& وفواصل الأسطر الخاصة بـ unicode.
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029")
}
