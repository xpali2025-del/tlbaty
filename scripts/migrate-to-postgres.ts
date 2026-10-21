/**
 * ترحيل الكتالوج من ملفات JSON إلى PostgreSQL (جداول store) مع رفع الصور إلى Cloudflare R2.
 * بديل scripts/migrate-to-sanity.mjs.
 *
 * الاستخدام:
 *   pnpm migrate:catalog -- --dry-run      فحص البيانات والصور فقط (بلا قاعدة ولا R2)
 *   pnpm migrate:catalog                   استيراد فعلي (يحتاج DATABASE_URL)
 *
 * الخيارات:
 *   --local-images        لا ترفع إلى R2؛ خزّن مسارات public/ كما هي (للتطوير)
 *   --data-dir <path>     مجلد البيانات (الافتراضي scripts/migration/data)
 *   --public-dir <path>   مجلد ملفات الصور (الافتراضي public)
 *
 * المتغيرات: DATABASE_URL (يُفضَّل الاتصال المباشر بالمنفذ 5432)،
 *   R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET لرفع الصور،
 *   وللصور غير الموجودة محلياً: SANITY_PROJECT_ID و SANITY_DATASET (تُنزَّل من Sanity CDN).
 *
 * آمن لإعادة التشغيل: مفاتيح طبيعية ثابتة، ومعاملة واحدة (إما كل شيء أو لا شيء).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { collectImagePaths, importCatalog, loadSeedData, validateSeed } from "./migration/import-catalog"
import { createImageResolver } from "./migration/images"

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const dataDir = path.resolve(option("--data-dir", path.join(here, "migration", "data")))
const publicDir = path.resolve(option("--public-dir", path.join(here, "..", "public")))
const dryRun = flag("--dry-run")
const localImages = flag("--local-images")
const cacheFile = path.join(here, "migration", ".r2-upload-cache.json")
const legacyAssetsFile = path.join(here, "migration", ".upload-cache.json") // مسار ← معرّف أصل Sanity
const reportFile = path.join(here, "migration", "missing-images.txt")

const readJsonIfExists = (file: string): Record<string, string> => {
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, string>
  } catch {
    return {}
  }
}

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

  const r2 = {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
  }
  const r2Ready = !localImages && Boolean(r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket)
  const s3 = r2Ready
    ? new S3Client({
        region: "auto",
        endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: r2.accessKeyId!, secretAccessKey: r2.secretAccessKey! },
      })
    : null

  const sanityProject = process.env.SANITY_PROJECT_ID ?? process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
  const sanityDataset = process.env.SANITY_DATASET ?? process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production"
  const cache = readJsonIfExists(cacheFile)

  const resolveImage = createImageResolver({
    publicDir,
    fileExists: existsSync,
    readFile,
    cache,
    saveCache: () => writeFileSync(cacheFile, JSON.stringify(cache, null, 2)),
    // في الفحص التجريبي لا رفع ولا تنزيل: نعدّ فقط ما هو موجود محلياً.
    upload:
      s3 && !dryRun
        ? async (key, body, contentType) => {
            await s3.send(
              new PutObjectCommand({
                Bucket: r2.bucket!,
                Key: key,
                Body: body,
                ContentType: contentType,
                CacheControl: "public, max-age=31536000, immutable",
              }),
            )
          }
        : undefined,
    sanity:
      sanityProject && !dryRun
        ? {
            projectId: sanityProject,
            dataset: sanityDataset,
            assetIds: readJsonIfExists(legacyAssetsFile),
            fetchBytes: async (url) => {
              const res = await fetch(url)
              return res.ok ? Buffer.from(await res.arrayBuffer()) : null
            },
          }
        : undefined,
    log: (m) => console.log(`   ⬆️  ${m}`),
  })

  if (dryRun) {
    const paths = collectImagePaths(data)
    const local = paths.filter((p) => existsSync(path.join(publicDir, p.replace(/^\/+/, ""))))
    const assetIds = readJsonIfExists(legacyAssetsFile)
    const viaSanity = paths.filter((p) => !local.includes(p) && assetIds[p])
    const missing = paths.filter((p) => !local.includes(p) && !assetIds[p])
    console.log(`\nالصور: ${paths.length} · موجودة محلياً ${local.length} · قابلة للتنزيل من Sanity ${viaSanity.length} · غير معروفة ${missing.length}`)
    if (viaSanity.length && !sanityProject) console.log("   (حدّد SANITY_PROJECT_ID لتنزيل الصور القابلة للتنزيل)")
    if (missing.length) console.log(`   مفقودة:\n   - ${missing.join("\n   - ")}`)
    console.log("\n✅ فحص تجريبي ناجح: لم يُكتب شيء في القاعدة أو R2.")
    return
  }

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("❌ DATABASE_URL غير مضبوط.")
    process.exit(1)
  }
  console.log(`\nالصور: ${r2Ready ? "رفع إلى R2" : "وضع محلي (مسارات public/ كما هي)"}`)

  const client = postgres(url, { prepare: false, max: 1 })
  try {
    const report = await importCatalog(drizzle(client), data, { resolveImage, log: (m) => console.log(`✅ ${m}`) })
    if (report.missingImages.length) {
      writeFileSync(reportFile, report.missingImages.join("\n") + "\n")
      console.warn(`\n⚠️  ${report.missingImages.length} صورة لم تُحلّ (حُفظت القائمة في ${path.relative(process.cwd(), reportFile)}).`)
      console.warn("    المنتجات المتأثرة تظهر بصورة بديلة حتى تُضاف صورها من لوحة الإدارة.")
    }
    console.log("\n🎉 اكتمل الترحيل.")
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error("\n❌ فشل الترحيل:", err instanceof Error ? err.message : err)
  process.exit(1)
})
