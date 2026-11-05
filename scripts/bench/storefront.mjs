// زمن تصفح المتجر (أول بايت وكامل الصفحة) عبر وسيط التأخير: الصفحات الديناميكية تقرأ القاعدة في كل طلب.
// ليس ضمن CI. التشغيل: BASE=http://127.0.0.1:3311 ROUNDS=15 node scripts/bench/storefront.mjs
const BASE = process.env.BASE || "http://127.0.0.1:3311"
const ROUNDS = Number(process.env.ROUNDS || 15)
const PATHS = (process.env.PATHS || "/,/shop,/search?q=a,/api/health").split(",")
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]
for (const path of PATHS) {
  const times = []
  for (let i = 0; i < ROUNDS + 1; i++) {
    const t = performance.now()
    const res = await fetch(BASE + path, { headers: { "cache-control": "no-cache" } })
    await res.arrayBuffer()
    if (i > 0) times.push(performance.now() - t) // الأول تسخين
    if (!res.ok && i === 1) console.log(`  ! ${path} → ${res.status}`)
  }
  console.log(`| ${path} | ${median(times).toFixed(0)} | ${p95(times).toFixed(0)} |`)
}
