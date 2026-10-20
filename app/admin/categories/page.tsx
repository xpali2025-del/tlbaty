import { saveCategory } from '@/app/actions/admin'
import { listCategories } from '@/lib/queries/admin'

export default async function AdminCategories() {
  const items = await listCategories()
  return (
    <main>
      <h1 className="mb-4 text-2xl font-bold">التصنيفات</h1>
      <form action={saveCategory} className="mb-6 flex gap-2">
        <input name="name" required placeholder="الاسم" className="rounded border px-3 py-2" />
        <input name="slug" required dir="ltr" placeholder="slug" className="rounded border px-3 py-2" />
        <button className="rounded-lg bg-primary px-4 py-2 text-primary-foreground">إضافة</button>
      </form>
      <ul className="divide-y">
        {items.map((c) => (
          <li key={c.id} className="py-2">{c.name} <span dir="ltr" className="text-sm text-muted-foreground">({c.slug})</span></li>
        ))}
      </ul>
    </main>
  )
}
