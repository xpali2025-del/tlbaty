import { getFooterCategories } from "@/lib/data"
import { FooterView } from "./footer-view"

// ============================================
// الفوتر (Server Component) — يجلب الأقسام من قاعدة البيانات
// ويعرضها ضمن HTML الثابت للأرشفة و SEO.
// الأقسام ديناميكية بالكامل: أي قسم يُحذف أو يتغيّر سلاجه
// في قاعدة البيانات ينعكس هنا تلقائياً بلا روابط مكسورة (404).
// ============================================
export async function Footer() {
  const categories = await getFooterCategories()
  return <FooterView categories={categories} />
}
