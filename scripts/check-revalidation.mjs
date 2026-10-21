import { readFileSync, readdirSync, statSync } from "node:fs"
import { extname, join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const sourceRoots = ["app", "components", "lib", "sanity"]
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"])
const failures = []

function collectFiles(directory) {
  const absolute = join(root, directory)
  const files = []

  for (const entry of readdirSync(absolute)) {
    const path = join(absolute, entry)
    if (statSync(path).isDirectory()) files.push(...collectFiles(join(directory, entry)))
    else if (sourceExtensions.has(extname(entry))) files.push(path)
  }

  return files
}

function requireMatch(content, expression, message) {
  if (!expression.test(content)) failures.push(message)
}

for (const file of sourceRoots.flatMap(collectFiles)) {
  const content = readFileSync(file, "utf8")
  const relative = file.slice(root.length + 1)

  if (/export\s+const\s+revalidate\s*=\s*\d+/u.test(content)) {
    failures.push(`${relative}: ما زال يحتوي على revalidate زمني`)
  }
  if (/force-dynamic/u.test(content)) {
    failures.push(`${relative}: يحتوي على force-dynamic`)
  }
  if (/revalidate\s*[:=]\s*0\b/u.test(content)) {
    failures.push(`${relative}: يحتوي على revalidate = 0`)
  }
}

const route = readFileSync(join(root, "app/api/revalidate/route.ts"), "utf8")
requireMatch(route, /parseBody<.*>\(req, secret, true\)/su, "Route لا يتحقق من توقيع Sanity أو لا ينتظر الاتساق")
requireMatch(route, /revalidateTag\(tag, \{ expire: 0 \}\)/u, "Route لا يستخدم انتهاءً فورياً لوسوم Webhook")
requireMatch(route, /revalidatePath\(path\)/u, "Route لا يبطل Full Route Cache للمسارات المتأثرة")
requireMatch(route, /SUPPORTED_TYPES/u, "Route لا يقيّد أنواع المستندات المقبولة")

const client = readFileSync(join(root, "sanity/client.ts"), "utf8")
requireMatch(client, /cache: "force-cache"/u, "عميل Sanity لا يحافظ على Data Cache")
requireMatch(client, /next: \{ tags \}/u, "استعلامات Sanity لا تمرر cache tags")

const envExample = readFileSync(join(root, ".env.example"), "utf8")
requireMatch(envExample, /NEXT_PUBLIC_SANITY_USE_CDN=false/u, ".env.example لا يعطل Sanity CDN")
requireMatch(envExample, /^SANITY_REVALIDATE_SECRET=$/mu, ".env.example لا يعرّف سر Webhook الخادمي")

if (failures.length > 0) {
  console.error("فشل فحص On-Demand Revalidation:\n")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("نجح فحص On-Demand Revalidation:")
console.log("- لا يوجد revalidate زمني أو force-dynamic أو revalidate = 0 في المصدر")
console.log("- Route الموقّع يستخدم revalidateTag الفوري وrevalidatePath")
console.log("- استعلامات Sanity تستخدم force-cache مع cache tags")
console.log("- متغيرات البيئة الأساسية موثقة بأمان")
