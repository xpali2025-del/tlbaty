// زمن التنقل بين شاشات المتجر كما يراه العميل: من النقر حتى يظهر محتوى الشاشة الجديدة. ليس ضمن CI.
// التشغيل: BASE=http://127.0.0.1:3311 ROUNDS=5 node scripts/bench/navigation.mjs
// كل جولة في متصفح جديد (بلا كاش). «بعد خمول»: ينتظر ثانيتين قبل النقر (تفعيل الجلب المسبق كما يحدث مع المستخدم الحقيقي).
// NET_LATENCY_MS: تأخير إضافي لكل طلب (يحاكي بعد العميل عن الخادم).
import { createRequire } from "node:module"
const { chromium } = createRequire(import.meta.url)("playwright")
const BASE = process.env.BASE || "http://127.0.0.1:3311"
const ROUNDS = Number(process.env.ROUNDS || 5)
const NET = Number(process.env.NET_LATENCY_MS || 40)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]

// READY: الصفحة الحقيقية جاهزة = main بلا aria-busy (هيكل الانتظار loading.tsx يحمله)
const READY = "main:not([aria-busy='true'])"
// to: جزء الرابط الذي يجب أن يصير إليه العنوان، ready: عنصر لا يوجد في هيكل الانتظار (loading) بل في الصفحة الحقيقية
const STEPS = [
  { name: "الرئيسية ← قسم", from: "/", click: "a[href='/category/{cat}']", to: "/category/", ready: READY },
  { name: "قسم ← منتج", from: "/category/{cat}", click: "a[href^='/product/']", to: "/product/", ready: READY },
  { name: "منتج ← رجوع للقسم", from: "/product/{prod}", back: true, to: "/category/", ready: READY },
  { name: "الرئيسية ← كل المنتجات", from: "/", click: "a[href='/shop']", to: "/shop", ready: READY },
  { name: "الرئيسية ← الأقسام", from: "/", click: "a[href='/categories']", to: "/categories", ready: READY },
  { name: "الرئيسية ← الماركات", from: "/", click: "a[href='/brands']", to: "/brands", ready: READY },
]

async function discover(page) {
  await page.goto(BASE + "/")
  const cat = (await page.locator("a[href^='/category/']").first().getAttribute("href"))?.replace("/category/", "")
  await page.goto(`${BASE}/category/${cat}`)
  const prod = (await page.locator("a[href^='/product/']").first().getAttribute("href"))?.replace("/product/", "")
  return { cat, prod }
}

async function measure(browser, ids, step, idle) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  // صور المتجر على نطاق R2 وهمي في هذه البيئة: تُجاب فوراً بصورة صغيرة فلا تُبطئ الحدث load
  const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
  await page.route((u) => u.host === "cdn.bench.test", (route) => route.fulfill({ status: 200, contentType: "image/gif", body: PIXEL }))
  if (NET) await page.route((u) => u.host !== "cdn.bench.test", async (route) => { await sleep(NET); return route.fallback() })
  const url = BASE + step.from.replace("{cat}", ids.cat).replace("{prod}", ids.prod)
  await page.goto(url, { waitUntil: "load" })
  await page.waitForSelector("main", { state: "attached" })
  if (step.back) {
    // نأتي للمنتج من القسم (تنقل داخلي) ثم نرجع
    await page.goto(`${BASE}/category/${ids.cat}`, { waitUntil: "load" })
    await page.locator("a[href^='/product/']").filter({ visible: true }).first().click()
    await page.waitForSelector("h1", { state: "attached" })
  }
  if (idle) await sleep(2000)
  const t0 = Date.now()
  if (step.back) await page.goBack()
  else {
    // الرابط المرئي فقط (قد توجد نسخ مخفية في القائمة الجانبية)
    // نقرة برمجية (بعض الروابط في الذيل المطوي): تمر من معالج Link نفسه كالنقرة الحقيقية
    await page.locator(step.click.replace("{cat}", ids.cat)).first().evaluate((el) => el.click())
  }
  await page.waitForURL((u) => u.pathname.includes(step.to), { timeout: 15000 })
  await page.waitForSelector(step.ready, { state: "attached", timeout: 15000 })
  const ms = Date.now() - t0
  await context.close()
  return ms
}

const browser = await chromium.launch()
const probe = await (await browser.newContext()).newPage()
const ids = await discover(probe)
console.log(`قسم: ${ids.cat} · منتج: ${ids.prod} · تأخير شبكة ${NET}ms لكل طلب\n`)
console.log("| الانتقال | فوري: وسيط | فوري: p95 | بعد خمول 2ث: وسيط | بعد خمول: p95 |\n|---|---|---|---|---|")
for (const step of STEPS) {
  const row = []
  for (const idle of [false, true]) {
    const times = []
    for (let i = 0; i < ROUNDS; i++) times.push(await measure(browser, ids, step, idle).catch((e) => { if (process.env.DEBUG) console.log("   خطأ:", String(e.message).split("\n")[0]); return 15000 }))
    row.push(`${median(times)} | ${p95(times)}`)
  }
  console.log(`| ${step.name} | ${row.join(" | ")} |`)
}
await browser.close()
