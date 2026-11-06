// اختبار صمود الحفظ الفوري (المرحلة 7 من docs/admin-instant-save-plan.md) على خادم إنتاج حقيقي. ليس ضمن CI.
// يكرر N عملية حفظ عشوائية على كل الشاشات مع: قطع الإنترنت (أثناء الرفع والحفظ)، رد يضيع بعد التزام الخادم، تحديث الصفحة
// في منتصف الحفظ، بطء الخادم، رفض متعمد من الخادم، ونافذتين تعدّلان المنتج نفسه. ثم يتحقق من القاعدة:
//   صفر ضياع (كل عملية محفوظة، أو ظاهرة فاشلة ببياناتها) · صفر تكرار · صفر فشل صامت (كل فشل شارة حمراء) · صفر صور يتيمة.
// التشغيل (أعد تشغيل الخادم قبله: كابح الدخول في الذاكرة):
//   set -a; . /tmp/e2e.env; set +a; N=200 SEED=1 FIXTURES=/tmp/claude-0/perf/fixtures node scripts/e2e/resilience.e2e.mjs
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const { chromium } = createRequire(import.meta.url)("playwright")
const BASE = process.env.BASE || "http://127.0.0.1:3311"
const FIXTURES = process.env.FIXTURES || "/tmp/claude-0/perf/fixtures"
const N = Number(process.env.N || 200)
const SEED = Number(process.env.SEED || Date.now() % 100000)
const VIEWPORT = { width: Number(process.env.WIDTH || 1280), height: 900 }
const sql = (q) => execFileSync("psql", [process.env.DATABASE_URL, "-tAc", q], { encoding: "utf8" }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// عشوائية قابلة للإعادة بالبذرة نفسها
let state = SEED >>> 0
const rnd = () => {
  state = (state + 0x6d2b79f5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const weighted = (table) => {
  const total = table.reduce((s, [, w]) => s + w, 0)
  let r = rnd() * total
  for (const [v, w] of table) if ((r -= w) <= 0) return v
  return table[0][0]
}
const between = (a, b) => a + rnd() * (b - a)

const RUN = Date.now().toString(36)
let seq = 0
const label = (prefix) => `${prefix}-${RUN}-${String(++seq).padStart(4, "0")}z`

const problems = []
const note = (msg) => {
  problems.push(msg)
  console.log(`   ✗ ${msg}`)
}

// ---------- تعريف الشاشات ----------
const photo = `${FIXTURES}/photo-1.jpg`
const EDIT = "button:has(span.sr-only:text('تعديل')), button[aria-label='تعديل']"
const ROW = "[data-testid=item-row], [data-testid=product-row]"
const SCREENS = {
  categories: { nav: "الأقسام", add: "قسم جديد", table: "categories", col: "name", file: "image", fill: (d, l) => d.locator("input[name=name]").fill(l) },
  brands: { nav: "البراندات", add: "براند جديد", table: "brands", col: "name", file: "image", fill: (d, l) => d.locator("input[name=name]").fill(l) },
  slides: { nav: "السلايدر", add: "سلايد جديد", table: "slides", col: "title", file: "image", fileRequired: true, fill: (d, l) => d.locator("input[name=title]").fill(l) },
  coupons: {
    nav: "أكواد الخصم", add: "كوبون جديد", table: "coupons", col: "code", upper: true,
    fill: async (d, l) => {
      await d.locator("input[name=code]").fill(l)
      await d.locator("input[name=discount]").fill("10")
      await d.locator("input[name=description]").fill("e2e")
    },
  },
  reviews: {
    nav: "آراء العملاء", add: "تقييم جديد", table: "reviews", col: "name", file: "avatar",
    fill: async (d, l) => {
      await d.locator("input[name=name]").fill(l)
      await d.locator("textarea[name=comment]").fill("ممتاز")
    },
  },
  ads: { nav: "الإعلانات", add: "إعلان جديد", table: "ads", col: "title", file: "image", fileRequired: true, fill: (d, l) => d.locator("input[name=title]").fill(l) },
  "payment-accounts": {
    nav: "حسابات الدفع", add: "حساب جديد", table: "payment_accounts", col: "provider_name",
    fill: async (d, l) => {
      await d.locator("input[name=providerName]").fill(l)
      await d.locator("input[name=accountHolderName]").fill("e2e")
      await d.locator("input[name=accountNumber]").fill("123456")
    },
  },
  products: {
    nav: "المنتجات", add: "منتج جديد", table: "products", col: "name", file: "image",
    fill: async (d, l, page) => {
      await d.locator("input[name=name]").fill(l)
      await d.locator("input[name=price]").fill("55")
      await d.locator("input[name=slug]").fill(l.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
      await d.getByRole("combobox").first().click()
      await page.getByRole("option").first().click()
    },
  },
}
const IMAGE_COL = { categories: "image_key", brands: "image_key", slides: "image_key", reviews: "avatar_key", ads: "image_key", "payment-accounts": "image_key", products: "main_image_key" }
const rowKey = (s, l) => (s.upper ? l.toUpperCase() : l)
const dbCount = (s, l) => Number(sql(`select count(*) from store.${s.table} where ${s.col}='${rowKey(s, l)}'`))

// ---------- المتصفح ----------
const r2Keys = new Set()
let r2Mode = { delay: 0 }
const CORS = { "access-control-allow-origin": "*", "access-control-expose-headers": "etag" }
const isManage = (url) => url.pathname.startsWith("/manage")

async function login(context) {
  const page = await context.newPage()
  page.on("dialog", (d) => void d.accept()) // تحذير الإغلاق أثناء الحفظ
  await page.route(
    (url) => url.host.endsWith("r2.cloudflarestorage.com"),
    async (route) => {
      if (route.request().method() !== "PUT") return route.fulfill({ status: 204, headers: CORS })
      if (r2Mode.delay) await sleep(r2Mode.delay)
      const url = new URL(route.request().url())
      r2Keys.add(decodeURIComponent(url.pathname.replace(/^\/(bench\/)?/, "")))
      return route.fulfill({ status: 200, headers: { ...CORS, etag: '"e2e"' }, body: "" })
    },
  )
  await page.goto(BASE + "/manage/login")
  await page.fill("#username", process.env.MANAGE_USERNAME)
  await page.fill("#password", process.env.MANAGE_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(BASE + "/manage", { timeout: 60000 })
  await page.waitForSelector("nav button")
  return page
}

const dialog = (page) => page.locator("[role=dialog]")
const submit = (page) => page.getByRole("button", { name: "حفظ التغييرات" })
// الصف الحقيقي للعنصر: يستثنى صف أحمر فاشل بالاسم نفسه (محاولة مكرّرة مرفوضة عمداً تظهر بجانب الأصلي)
const row = (page, text) => page.locator(ROW.split(",").map((x) => `${x.trim()}:not([data-save-state=failed])`).join(", "), { hasText: text })
const stateOf = (page, text) => row(page, text).first().getAttribute("data-save-state")

async function gotoScreen(page, s) {
  await page.click(`nav >> text=${s.nav}`)
  await page.waitForSelector(`button:has-text('${s.add}')`)
}

async function waitUploadsDone(page) {
  await page.waitForFunction(() => {
    const els = [...document.querySelectorAll("[role=dialog] [data-upload-state]")]
    return els.every((e) => e.getAttribute("data-upload-state") !== "working")
  }, null, { timeout: 40000 })
}

// ---------- العمليات ----------
const expected = [] // {screen, label, kind: 'saved'|'rejected'|'edited', ...}

/** يضبط ما يحدث للشبكة بين الضغط على «حفظ» وبقية العملية. يعيد دالة تُنهي الاضطراب. */
async function disrupt(page, context, kind) {
  switch (kind) {
    case "offline": {
      await context.setOffline(true)
      return async () => {
        await sleep(between(300, 2500))
        await context.setOffline(false)
      }
    }
    case "lose": {
      let aborted = 0
      const handler = async (route) => {
        if (route.request().method() !== "POST" || aborted >= 1) return route.continue()
        aborted++
        await route.fetch()
        await route.abort("failed")
      }
      await page.route(isManage, handler)
      return async () => {
        await sleep(3500)
        await page.unroute(isManage, handler)
      }
    }
    case "slow": {
      const handler = async (route) => {
        if (route.request().method() === "POST") await sleep(between(800, 2500))
        return route.continue()
      }
      await page.route(isManage, handler)
      return async () => {
        await sleep(3500)
        await page.unroute(isManage, handler)
      }
    }
    case "reload": {
      const handler = (route) => (route.request().method() === "POST" ? new Promise(() => {}) : route.continue())
      await page.route(isManage, handler)
      return async () => {
        await sleep(between(300, 1500)) // يُكتب في IndexedDB قبل الإرسال
        await page.unroute(isManage, handler)
        await page.reload()
        await page.waitForSelector("nav button")
      }
    }
    default:
      return async () => {}
  }
}

async function createOp(page, context, name, disruption, reject) {
  const s = SCREENS[name]
  await gotoScreen(page, s)
  const l = label(name === "coupons" ? "E2E" : "r")
  let finalLabel = l
  if (reject) {
    // اسم/كود مكرر لعنصر موجود فيرفضه الخادم بعد إغلاق النافذة. التفرّد على الرابط (slug) المشتق من الاسم عند الإنشاء،
    // فنستثني ما أُعيدت تسميته (اسمه الحالي لا يطابق رابطه فيُقبل اسم مكرر بحق)
    const existing = (() => { const c = expected.filter((e) => e.screen === name && e.kind === "saved" && !e.edited && !e.editOf && seq - e.createdAt > 8 && dbCount(s, e.label) === 1); return c.length ? pick(c) : null })()
    if (!existing) return null
    finalLabel = existing.label
  }
  await page.click(`button:has-text('${s.add}')`)
  await dialog(page).waitFor()
  await s.fill(dialog(page), finalLabel, page)
  const withImage = s.file && (s.fileRequired || rnd() < 0.5)
  if (withImage) {
    if (disruption === "offline-upload") await context.setOffline(true)
    await dialog(page).locator(`input[type=file][name=${s.file}]`).setInputFiles(photo)
    if (name === "products" && rnd() < 0.5) await dialog(page).locator("input[type=file][name=newImages]").setInputFiles([photo]).catch(() => {})
    if (disruption !== "offline-upload") await waitUploadsDone(page)
  }
  const end = disruption === "offline-upload" ? await disrupt(page, context, "none") : await disrupt(page, context, disruption)
  if (disruption !== "offline" && disruption !== "offline-upload") await sleep(0)
  await submit(page).click()
  await dialog(page).waitFor({ state: "hidden", timeout: 4000 }).catch(() => note(`${name} ${finalLabel}: النافذة لم تُغلق بعد «حفظ» (${disruption})`))
  await end()
  if (disruption === "offline-upload") {
    await sleep(between(500, 2500))
    await context.setOffline(false)
  }
  expected.push({ screen: name, label: finalLabel, kind: reject ? "rejected" : "saved", of: reject ? expected.find((e) => e.screen === name && e.label === finalLabel && e.kind !== "rejected") : undefined, disruption, createdAt: seq, newLabel: reject ? l : undefined, withImage: Boolean(withImage) && !reject })
  return finalLabel
}

async function editOp(page, name) {
  const s = SCREENS[name]
  const candidates = expected.filter((e) => e.screen === name && e.kind === "saved" && !e.edited && seq - e.createdAt > 8)
  if (!candidates.length) return false
  const target = pick(candidates)
  await gotoScreen(page, s)
  // نكتفي بعنصر استقر في القائمة (الإنشاء القديم اكتمل)
  const r = row(page, rowKey(s, target.label)).first()
  const settled = await page.waitForFunction(([sel, t]) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(t) && e.getAttribute("data-save-state") !== "failed")
    return el && el.getAttribute("data-save-state") === "saved"
  }, [ROW, rowKey(s, target.label)], { timeout: 25000 }).then(() => true, () => false)
  if (!settled) return false
  await r.locator(EDIT).first().click()
  await dialog(page).waitFor()
  const edited = label(name === "coupons" ? "E2E" : "r")
  await s.fill(dialog(page), edited, page)
  await submit(page).click()
  await dialog(page).waitFor({ state: "hidden", timeout: 4000 }).catch(() => note(`${name} تعديل ${target.label}: النافذة لم تُغلق`))
  target.edited = true
  target.kind = "replaced"
  expected.push({ screen: name, label: edited, kind: "saved", createdAt: seq, editOf: target.label })
  return true
}

async function conflictOp(pageA, pageB, context) {
  const s = SCREENS.products
  const candidates = expected.filter((e) => e.screen === "products" && e.kind === "saved" && !e.edited && seq - e.createdAt > 10)
  if (!candidates.length) return false
  const target = pick(candidates)
  for (const p of [pageA, pageB]) {
    await p.reload()
    await p.waitForSelector("nav button")
    await gotoScreen(p, s)
  }
  const ready = await pageB.waitForFunction(([sel, t]) => [...document.querySelectorAll(sel)].some((e) => e.textContent.includes(t)), [ROW, target.label], { timeout: 20000 }).then(() => true, () => false)
  if (!ready) return false
  const priceA = String(1000 + Math.floor(rnd() * 400))
  const priceB = String(2000 + Math.floor(rnd() * 400))
  await row(pageB, target.label).first().locator(EDIT).first().click()
  await dialog(pageB).waitFor()
  await row(pageA, target.label).first().locator(EDIT).first().click()
  await dialog(pageA).waitFor()
  await dialog(pageA).locator("input[name=price]").fill(priceA)
  await submit(pageA).click()
  await dialog(pageA).waitFor({ state: "hidden", timeout: 4000 })
  const savedA = await waitDbPrice(target.label, priceA)
  if (!savedA) {
    const jobs = await pageA.evaluate(() => new Promise((res) => { const r = indexedDB.open("tajline-save-queue"); r.onsuccess = () => { const g = r.result.transaction("jobs").objectStore("jobs").getAll(); g.onsuccess = () => res(g.result.map((j) => ({ state: j.state, screen: j.screen, label: j.label, error: j.error }))) } })).catch(() => [])
    const badge = await row(pageA, target.label).first().getAttribute("data-save-state").catch(() => "؟")
    const dbRow = sql(`select price, version from store.products where name='${target.label}'`)
    console.log(`   تشخيص: صف=${badge} قاعدة=${dbRow} طابور=${JSON.stringify(jobs.filter((j) => j.screen === "products").slice(-5))} تاريخ ${JSON.stringify(expected.filter((e) => e.label === target.label || e.editOf === target.label))}`)
    note(`تعارض ${target.label}: حفظ التبويب الأول لم يصل`)
    return false
  }
  await dialog(pageB).locator("input[name=price]").fill(priceB)
  await submit(pageB).click()
  await dialog(pageB).waitFor({ state: "hidden", timeout: 4000 })
  const conflictShown = await row(pageB, target.label).locator("[data-testid=save-problem]").waitFor({ timeout: 20000 }).then(() => true, () => false)
  if (!conflictShown) return note(`تعارض ${target.label}: لم تظهر شاشة التعارض`) && false
  if (rnd() < 0.5) {
    await pageB.getByRole("button", { name: "احتفظ بتعديلي" }).click()
    target.price = priceB
  } else {
    await pageB.getByRole("button", { name: "خذ النسخة الجديدة" }).click()
    target.price = priceA
  }
  target.conflicts = (target.conflicts ?? 0) + 1
  expected.push({ screen: "products", label: target.label, kind: "price-check", price: target.price })
  return true
}
async function waitDbPrice(l, price, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (sql(`select price from store.products where name='${l}'`).startsWith(price)) return true
    await sleep(250)
  }
  return false
}

async function settingsOp(page, context, disruption) {
  await page.click("nav >> text=إعدادات الموقع")
  const tagline = page.locator("input[name=tagline]").first()
  await tagline.waitFor()
  const value = label("tag")
  await tagline.fill(value)
  const end = await disrupt(page, context, disruption === "offline-upload" ? "none" : disruption)
  await page.getByRole("button", { name: "حفظ التغييرات" }).click()
  await end()
  expected.push({ screen: "settings", label: value, kind: "settings", createdAt: seq })
}

// ---------- التشغيل ----------
;(async () => {
  console.log(`بذرة ${SEED} · ${N} عملية · عرض ${VIEWPORT.width}px`)
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: VIEWPORT })
  const page = await login(context)
  const contextB = await browser.newContext({ viewport: VIEWPORT })
  const pageB = await login(contextB)
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))

  const kinds = [["create", 55], ["edit", 18], ["reject", 9], ["conflict", 6], ["settings", 4], ["burst", 8]]
  const disruptions = [["none", 30], ["offline", 20], ["lose", 14], ["reload", 14], ["slow", 10], ["offline-upload", 12]]
  const screenNames = Object.keys(SCREENS)
  const t0 = Date.now()
  const counts = {}
  for (let i = 1; i <= N; i++) {
    const kind = weighted(kinds)
    const disruption = weighted(disruptions)
    const name = pick(screenNames)
    counts[kind] = (counts[kind] ?? 0) + 1
    try {
      if (kind === "create") await createOp(page, context, name, disruption, false)
      else if (kind === "reject") {
        const rejectable = ["coupons", "categories", "brands", "products"] // لها قيد تفرّد يرفضه الخادم
        await createOp(page, context, pick(rejectable), "none", true)
      } else if (kind === "edit") await editOp(page, name)
      else if (kind === "conflict") await conflictOp(page, pageB, context)
      else if (kind === "settings") await settingsOp(page, context, disruption)
      else if (kind === "burst") {
        // أربع عمليات متتالية بلا انتظار: الطابور يعمل بتوازٍ
        for (const n of [pick(["categories", "brands", "reviews"]), pick(["coupons", "payment-accounts"]), "categories", "reviews"]) await createOp(page, context, n, "none", false)
      }
    } catch (error) {
      note(`عملية ${i} (${kind}/${name}/${disruption}) رمت: ${String(error?.message ?? error).split("\n")[0]}`)
      await context.setOffline(false).catch(() => {})
      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {})
      await page.reload().catch(() => {})
      await page.waitForSelector("nav button").catch(() => {})
    }
    if (i % 10 === 0) console.log(`  ${i}/${N} · ${((Date.now() - t0) / 1000).toFixed(0)}s · مشاكل حتى الآن: ${problems.length}`)
    await sleep(between(0, 600))
  }
  console.log(`أنواع العمليات: ${JSON.stringify(counts)}`)

  // ---------- انتظار تفريغ الطابور ----------
  await context.setOffline(false)
  await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {})
  console.log("انتظار تفريغ الطابور…")
  const drained = await page
    .waitForFunction(() => !document.querySelector("[data-testid=save-status-working]") && !document.querySelector("[data-testid=save-status-waiting]"), null, { timeout: 180000, polling: 500 })
    .then(() => true, () => false)
  if (!drained) note("الطابور لم يفرغ خلال 3 دقائق (عمليات ما زالت تعمل أو تنتظر)")
  await sleep(3000)

  // ---------- التحقق ----------
  console.log("\n## التحقق من القاعدة")
  let saved = 0, rejected = 0, lost = 0, dup = 0
  for (const e of expected) {
    const s = SCREENS[e.screen]
    if (e.kind === "saved") {
      saved++
      const n = dbCount(s, e.label)
      if (n === 0) { lost++; note(`ضياع: ${e.screen} «${e.label}» (${e.disruption ?? "تعديل"}) غير موجود في القاعدة`) }
      if (n > 1) { dup++; note(`تكرار: ${e.screen} «${e.label}» ${n} مرات`) }
      // صورة اختارها المدير يجب أن تصل للعنصر (ضياع الصورة وحدها ضياع)
      if (e.withImage && n === 1 && IMAGE_COL[e.screen]) {
        const hasImage = sql(`select ${IMAGE_COL[e.screen]} is not null from store.${s.table} where ${s.col}='${rowKey(s, e.label)}'`) === "t"
        if (!hasImage) { lost++; note(`ضياع صورة: ${e.screen} «${e.label}» (${e.disruption}) حُفظ بلا الصورة التي اختارها المدير`) }
      }
    } else if (e.kind === "replaced") {
      // الاسم القديم زال (تعديل) أو بقي بحسب تدفق الطابور: يجب ألا يكون هناك أكثر من واحد
      const n = dbCount(s, e.label)
      if (n > 1) { dup++; note(`تكرار: ${e.screen} «${e.label}» ${n} مرات`) }
    } else if (e.kind === "rejected") {
      rejected++
      const n = dbCount(s, e.label)
      // الأصل أُعيدت تسميته بعد المحاولة المرفوضة: غيابه طبيعي، والمهم ألا يوجد أكثر من واحد
      const renamedAfter = e.of && (e.of.edited || e.of.kind === "replaced")
      if (renamedAfter ? n > 1 : n !== 1) note(`رفض: «${e.label}» عددها ${n} (المتوقع 1، الأصلي فقط)`)
    } else if (e.kind === "settings") {
      // آخر قيمة تغلب (العمليات على الصف نفسه بالترتيب)
    } else if (e.kind === "price-check") {
      // آخر قرار فقط (قرار لاحق على المنتج نفسه يغلب)، وما أُعيدت تسميته بعدها يُتحقَّق منه باسمه الجديد في التعديل
      const later = expected.some((x, i) => i > expected.indexOf(e) && x.kind === "price-check" && x.label === e.label)
      const renamed = expected.some((x) => x.editOf === e.label)
      if (later || renamed) continue
      if (!sql(`select price from store.products where name='${e.label}'`).startsWith(e.price)) note(`تعارض: سعر «${e.label}» ليس ${e.price} كما اختار المدير`)
    }
  }
  const lastSettings = [...expected].reverse().find((e) => e.kind === "settings")
  if (lastSettings && sql("select tagline from store.site_settings") !== lastSettings.label) note(`الإعدادات: آخر قيمة محفوظة ليست «${lastSettings.label}»`)

  // التعديلات: القيمة الجديدة موجودة مرة واحدة والقديمة زالت
  for (const e of expected.filter((x) => x.editOf)) {
    const s = SCREENS[e.screen]
    if (dbCount(s, e.editOf) !== 0) note(`تعديل: القديم «${e.editOf}» ما زال في القاعدة (تعديل لم يُطبَّق أو تكرار)`)
  }

  // ---------- صفر فشل صامت: كل فشل شارة حمراء، وكل شارة حمراء متوقعة ----------
  const failedBadges = await page.evaluate(() => 0).then(() => 0)
  void failedBadges
  const idb = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("tajline-save-queue"); r.onsuccess = () => { const g = r.result.transaction("jobs").objectStore("jobs").getAll(); g.onsuccess = () => res(g.result.map((j) => ({ state: j.state, screen: j.screen, label: j.label, error: j.error }))) } })).catch(() => [])
  const failedJobs = idb.filter((j) => j.state === "failed" || j.state === "conflict")
  const stuck = idb.filter((j) => j.state === "queued" || j.state === "running" || j.state === "retrying")
  if (stuck.length) note(`${stuck.length} عملية عالقة في IndexedDB بلا فشل ظاهر: ${stuck.map((j) => `${j.screen}/${j.label}`).join("، ")}`)
  const expectedRejects = new Set(expected.filter((e) => e.kind === "rejected").map((e) => `${e.screen}:${e.label.toLowerCase()}`))
  for (const j of failedJobs) {
    const key = `${j.screen}:${String(j.label).toLowerCase()}`
    if (!expectedRejects.has(key)) note(`فشل غير متوقع في الطابور: ${j.screen} «${j.label}»: ${j.error}`)
  }
  // كل رفض متوقع له عنصر أحمر ظاهر (في شاشته) ببياناته
  for (const e of expected.filter((x) => x.kind === "rejected")) {
    const inQueue = failedJobs.some((j) => j.screen === e.screen && String(j.label).toLowerCase() === e.label.toLowerCase())
    if (!inQueue) note(`فشل صامت؟ الرفض المتوقع «${e.label}» في ${e.screen} بلا عملية فاشلة محفوظة`)
  }
  // الشارات الحمراء ظاهرة فعلاً في الشاشات
  for (const name of new Set(expected.filter((x) => x.kind === "rejected").map((x) => x.screen))) {
    await gotoScreen(page, SCREENS[name])
    const red = await page.locator(`${ROW}`).evaluateAll((els) => els.filter((e) => e.getAttribute("data-save-state") === "failed").length)
    const wanted = failedJobs.filter((j) => j.screen === name).length
    if (red !== wanted) note(`${name}: شارات حمراء ${red} ≠ عمليات فاشلة ${wanted}`)
  }

  // ---------- صفر صور يتيمة: كل كائن رُفع إما مُشار إليه أو مُسجَّل معلّقاً ليحذفه التنظيف اليومي ----------
  const referenced = new Set(
    sql(`select k from (
      select image_key k from store.categories union all select image_key from store.brands union all select main_image_key from store.products
      union all select image_key from store.product_images union all select image_key from store.ads union all select video_key from store.ads
      union all select image_key from store.slides union all select avatar_key from store.reviews union all select image_key from store.payment_accounts
      union all select logo_key from store.site_settings) t where k is not null`).split("\n").filter(Boolean),
  )
  const pending = new Set(sql("select object_key from store.pending_uploads").split("\n").filter(Boolean))
  const orphans = [...r2Keys].filter((k) => !referenced.has(k) && !pending.has(k))
  const staleButReferenced = [...pending].filter((k) => referenced.has(k)) // يزيله التنظيف بالمراجعة قبل الحذف
  console.log(`  كائنات رُفعت ${r2Keys.size} · مُشار إليها ${[...r2Keys].filter((k) => referenced.has(k)).length} · معلّقة (يحذفها التنظيف بعد 24 ساعة) ${[...r2Keys].filter((k) => pending.has(k)).length}`)
  if (orphans.length) note(`${orphans.length} كائن يتيم بلا إشارة ولا تسجيل معلّق: ${orphans.slice(0, 3).join("، ")}…`)
  void staleButReferenced

  if (errors.length) note(`أخطاء جافاسكربت في الصفحة: ${errors[0]}`)

  console.log(`\nنُفِّذت ${expected.length} عملية مسجَّلة: محفوظة ${saved} · مرفوضة عمداً ${rejected}`)
  console.log(`ضياع ${lost} · تكرار ${dup} · مشاكل ${problems.length}`)
  await browser.close()
  console.log(problems.length ? `\n✗ ${problems.length} مشكلة (البذرة ${SEED})` : `\n✓ صفر ضياع، صفر تكرار، صفر فشل صامت، صفر صور يتيمة (البذرة ${SEED})`)
  process.exit(problems.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
