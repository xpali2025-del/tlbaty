'use client'

export default function ProductsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-4xl p-4">
      <p>تعذّر تحميل المنتجات.</p>
      <button className="mt-2 underline" onClick={reset}>
        إعادة المحاولة
      </button>
    </main>
  )
}
