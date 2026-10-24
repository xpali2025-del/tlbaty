// فحص ميزانية حجم الحزم (JS مضغوط gzip) لكل صفحة بعد `next build`. يفشل (exit 1) عند تجاوز أي ميزانية.
//
// الطريقة: لكل صفحة نقرأ page_client-reference-manifest.js (فيه كل حزم JS التي يحمّلها المتصفح لهذه الصفحة
// بما فيها التخطيط)، ونضيف إليها حزم التشغيل المشتركة من build-manifest.json، ثم نجمع حجم gzip لكل ملف مرة واحدة.
// الرقم حد أعلى تقريبي لما يُحمَّل عند أول زيارة، وهو ما نقارنه عبر الزمن لكشف التضخم.
//
// الاستخدام: pnpm build && pnpm check:budget      (BUDGET_VERBOSE=1 لعرض كل الصفحات)
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { join, relative, sep } from "node:path"

const NEXT_DIR = join(process.cwd(), ".next")
const KB = 1024

// الميزانيات بالكيلوبايت (gzip)، مضبوطة على القياس الحالي + نحو 8% هامش نمو (أعلى متجر 278KB، اللوحة 329KB).
// الغاية منع التضخم غير المقصود لا فرض هدف مثالي؛ اخفضها كلما قلّصت الحزم (القاعدة المشتركة وحدها ~168KB).
const BUDGETS_KB = {
  default: 300,
  overrides: [{ match: /^\/manage(\/|$)/, kb: 360 }],
}

const exists = (p) => existsSync(p)
const gzipKb = (() => {
  const cache = new Map()
  return (file) => {
    if (!cache.has(file)) cache.set(file, gzipSync(readFileSync(join(NEXT_DIR, file))).length)
    return cache.get(file)
  }
})()

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}

function budgetFor(route) {
  return (BUDGETS_KB.overrides.find((o) => o.match.test(route))?.kb ?? BUDGETS_KB.default) * KB
}

function main() {
  const appDir = join(NEXT_DIR, "server", "app")
  const buildManifest = join(NEXT_DIR, "build-manifest.json")
  if (!exists(appDir) || !exists(buildManifest)) {
    console.error("لا يوجد ناتج بناء. شغّل `pnpm build` أولاً.")
    process.exit(2)
  }

  const shared = new Set()
  const bm = JSON.parse(readFileSync(buildManifest, "utf8"))
  for (const f of [...(bm.rootMainFiles ?? []), ...(bm.polyfillFiles ?? [])]) if (f.endsWith(".js")) shared.add(f)

  const rows = []
  for (const file of walk(appDir)) {
    if (!file.endsWith("page_client-reference-manifest.js")) continue
    const route = "/" + relative(appDir, file).split(sep).slice(0, -1).join("/")
    const text = readFileSync(file, "utf8")
    const chunks = new Set(shared)
    for (const m of text.matchAll(/\/_next\/(static\/[^"'\\]+?\.js)/g)) chunks.add(decodeURIComponent(m[1]))
    let bytes = 0
    for (const c of chunks) if (exists(join(NEXT_DIR, c))) bytes += gzipKb(c)
    rows.push({ route: route === "/" ? "/" : route.replace(/\/page$/, ""), bytes, limit: budgetFor(route), files: chunks.size })
  }

  if (rows.length === 0) {
    console.error("لم يُعثر على صفحات في ناتج البناء.")
    process.exit(2)
  }

  rows.sort((a, b) => b.bytes / b.limit - a.bytes / a.limit)
  const over = rows.filter((r) => r.bytes > r.limit)
  const shown = process.env.BUDGET_VERBOSE ? rows : rows.slice(0, 10)
  const fmt = (n) => (n / KB).toFixed(1).padStart(7)
  console.log("الصفحة".padEnd(40), "gzip KB".padStart(8), "الميزانية".padStart(10), "الحالة")
  for (const r of shown) {
    console.log(r.route.padEnd(40), fmt(r.bytes), String(r.limit / KB).padStart(10), r.bytes > r.limit ? "تجاوز" : "ok")
  }
  console.log(`\nالمشتركة (كل الصفحات): ${fmt([...shared].reduce((s, f) => s + (exists(join(NEXT_DIR, f)) ? gzipKb(f) : 0), 0))} KB gzip — ${rows.length} صفحة`)

  if (over.length > 0) {
    console.error(`\n✗ ${over.length} صفحة تجاوزت الميزانية:`)
    for (const r of over) console.error(`  ${r.route}: ${(r.bytes / KB).toFixed(1)}KB > ${r.limit / KB}KB`)
    process.exit(1)
  }
  console.log("\n✓ كل الصفحات ضمن الميزانية")
}

main()
