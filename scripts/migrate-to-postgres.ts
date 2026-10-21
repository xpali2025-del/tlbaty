/**
 * استيراد بيانات المتجر الأولية (أقسام، براندات، منتجات، سلايدر، كوبونات، تقييمات، إعلانات)
 * من ملفات JSON إلى PostgreSQL. بلا صور: تظهر صورة بديلة حتى تُرفع من لوحة الإدارة.
 *
 * الاستخدام:
 *   pnpm migrate:catalog -- --dry-run      فحص البيانات فقط (بلا قاعدة)
 *   pnpm migrate:catalog                   استيراد فعلي (يحتاج DATABASE_URL)
 *
 * الخيار: --data-dir <path>  مجلد البيانات (الافتراضي scripts/migration/data)
 * آمن لإعادة التشغيل: معاملة واحدة، والمنتجات والأقسام تُحدَّث بحسب slug.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { importCatalog, loadSeedData, validateSeed } from "./migration/import-catalog"

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const dirIndex = args.indexOf("--data-dir")
const dataDir = path.resolve(dirIndex >= 0 && args[dirIndex + 1] ? args[dirIndex + 1] : path.join(here, "migration", "data"))

async function main() {
  const data = loadSeedData(dataDir)
  const { errors, warnings } = validateSeed(data)
  console.log(
    `البيانات: ${data.categories.length} قسم، ${data.brands.length} براند، ${data.products.length} منتج، ` +
      `${data.slides.length} شريحة، ${data.coupons.length} كوبون، ${data.reviews.length} تقييم، ${data.ads.length} إعلان`,
  )
  for (const w of warnings) console.warn(`⚠️  ${w}`)
  if (errors.length) {
    for (const e of errors) console.error(`❌ ${e}`)
    process.exit(1)
  }
  if (dryRun) {
    console.log("\n✅ فحص تجريبي ناجح: لم يُكتب شيء في القاعدة.")
    return
  }

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("❌ DATABASE_URL غير مضبوط.")
    process.exit(1)
  }
  const client = postgres(url, { prepare: false, max: 1 })
  try {
    await importCatalog(drizzle(client), data, { assignCodes: true, log: (m) => console.log(`✅ ${m}`) })
    console.log("\n🎉 اكتمل الاستيراد.")
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error("\n❌ فشل الاستيراد:", err instanceof Error ? err.message : err)
  process.exit(1)
})
