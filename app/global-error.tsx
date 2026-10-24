"use client"

// آخر حدّ للأخطاء: يعمل حين يفشل التخطيط الجذري نفسه (مثلاً قراءة إعدادات الموقع من قاعدة غير مُرحَّلة)،
// وعندها لا يمكن لـ app/error.tsx أن يظهر. بدونه تكون النتيجة صفحة بيضاء. يجب أن يعرّف <html> و<body> بنفسه.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fff", color: "#111" }}>
        <main style={{ maxWidth: 420, margin: "0 auto", padding: "96px 16px", textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>حدث خطأ غير متوقع</h1>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#555" }}>
            تعذّر تحميل الصفحة. جرّب مرة أخرى، وإن استمر الخطأ فتواصل مع مدير الموقع.
          </p>
          {error.digest ? (
            <p dir="ltr" style={{ fontSize: 12, color: "#888" }}>
              digest: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 12, minHeight: 44, padding: "0 20px", borderRadius: 12, border: 0, background: "#111", color: "#fff", fontWeight: 700 }}
          >
            إعادة المحاولة
          </button>
        </main>
      </body>
    </html>
  )
}
