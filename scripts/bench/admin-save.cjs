// قياس زمن الحفظ في لوحة التحكم (المرحلة 0 من docs/admin-instant-save-plan.md).
//
// لكل سيناريو يقيس، من لحظة الضغط على «حفظ»:
//   A: حتى تعود الواجهة للمدير (تُغلق النافذة، أو تظهر رسالة النجاح في الإعدادات)
//   B: حتى يصل رد آخر طلب إلى الخادم (اكتمال الحفظ فعلياً)
//   U: حتى اكتمال رفع آخر صورة إلى R2 (0 إن لم تُرفع صور)
//   Q: عدد استعلامات قاعدة البيانات حتى استقرار الصفحة
//
// ما يُحاكى (وما لا يُحاكى):
//   - الشبكة: كل طلب إجراء خادم (POST) ورفع إلى R2 (PUT) يُؤخَّر بنموذج صريح:
//       RTT + حجم/سرعة الرفع عند الإرسال، وRTT + حجم/سرعة التنزيل عند الاستلام.
//     الأصول الثابتة وتحميل الصفحة غير مؤخَّرة (لا تدخل في القياس).
//   - R2: خادم وهمي يردّ 200 فوراً بعد زمن الإرسال المحاكى (لا يوجد R2 حقيقي هنا).
//   - قاعدة البيانات: الوسيط latency-proxy.mjs يضيف تأخيراً لكل اتجاه.
//   - لا يُحاكى بطء معالج الجوال: الضغط يعمل على معالج هذا الجهاز.
//
// الاستخدام: انظر scripts/bench/README.md
const { chromium } = require("playwright")
const fs = require("node:fs")
const path = require("node:path")

const BASE = process.env.BASE || "http://127.0.0.1:3311"
const COUNTER = process.env.COUNTER || "http://127.0.0.1:5434"
const FIXTURES = process.env.FIXTURES || "/tmp/claude-0/perf/fixtures"
const ROUNDS = Number(process.env.ROUNDS || 10)
const WARMUP = Number(process.env.WARMUP || 1)
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean)
const OUT = process.env.OUT || "/tmp/claude-0/perf/admin-save-results.json"
const VIEWPORT = { width: 390, height: 844 }

// ملف شبكة 4G: سرعة الرفع 1.5 Mbps والتنزيل 9 Mbps وزمن ذهاب وإياب 165 ms
const NET = { rttMs: Number(process.env.RTT_MS || 165), upBps: 1.5e6 / 8, downBps: 9e6 / 8 }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const photo = (n) => path.join(FIXTURES, `photo-${n}.jpg`)
const counter = async (reset) => Number(await (await fetch(COUNTER + (reset ? "/reset" : "/"))).text())

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
// الرتبة الأقرب: مع 10 قياسات تساوي القيمة الأكبر
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)]

const SAVE = "حفظ التغييرات"
const dialogEdit = (tab, nav) => async (page) => {
  await page.click(`nav >> text=${nav}`)
  await page.locator("button:has(span.sr-only:text('تعديل'))").first().click()
  await page.waitForSelector("[role=dialog]")
}

// كل سيناريو: يجهّز النموذج (بلا قياس) ثم يعيد دالة نتيجة النجاح
const SCENARIOS = [
  {
    id: "products-new-3img",
    label: "المنتجات: منتج جديد بـ 3 صور",
    images: 3,
    async prepare(page, run) {
      await page.click("nav >> text=المنتجات")
      await page.click("button:has-text('منتج جديد')")
      await page.waitForSelector("[role=dialog]")
      const dialog = page.locator("[role=dialog]")
      await dialog.locator("input[type=file][name=image]").setInputFiles(photo(1))
      await dialog.locator("input[type=file][name=newImages]").setInputFiles([photo(2), photo(3)])
      await dialog.locator("input[name=name]").fill(`bench منتج ${Date.now()}-${run}`)
      await dialog.locator("input[name=price]").fill("120")
      await dialog.getByRole("combobox").first().click()
      await page.getByRole("option").first().click()
    },
    done: { dialog: true },
  },
  {
    id: "products-edit-price",
    label: "المنتجات: تعديل سعر بلا صور",
    images: 0,
    async prepare(page, run) {
      await dialogEdit("products", "المنتجات")(page)
      await page.locator("[role=dialog] input[name=price]").fill(String(100 + run))
    },
    done: { dialog: true },
  },
  {
    id: "categories-edit-img",
    label: "الأقسام: تعديل قسم مع استبدال الصورة",
    images: 1,
    async prepare(page) {
      await dialogEdit("categories", "الأقسام")(page)
      await page.locator("[role=dialog] input[type=file][name=image]").setInputFiles(photo(1))
    },
    done: { dialog: true },
  },
  {
    id: "categories-edit-noimg",
    label: "الأقسام: تعديل قسم بلا صور",
    images: 0,
    async prepare(page, run) {
      await dialogEdit("categories", "الأقسام")(page)
      await page.locator("[role=dialog] input[name=sortOrder]").fill(String(run))
    },
    done: { dialog: true },
  },
  {
    id: "brands-edit-img",
    label: "البراندات: تعديل براند مع استبدال الشعار",
    images: 1,
    async prepare(page) {
      await dialogEdit("brands", "البراندات")(page)
      await page.locator("[role=dialog] input[type=file][name=image]").setInputFiles(photo(1))
    },
    done: { dialog: true },
  },
  {
    id: "slides-edit-img",
    label: "السلايدر: تعديل شريحة مع استبدال الصورة",
    images: 1,
    async prepare(page) {
      await dialogEdit("slides", "السلايدر")(page)
      await page.locator("[role=dialog] input[type=file][name=image]").setInputFiles(photo(1))
    },
    done: { dialog: true },
  },
  {
    id: "ads-edit-img",
    label: "الإعلانات: تعديل إعلان صورة مع استبدال الصورة",
    images: 1,
    async prepare(page) {
      await dialogEdit("ads", "الإعلانات")(page)
      await page.locator("[role=dialog] input[type=file][name=image]").setInputFiles(photo(1))
    },
    done: { dialog: true },
  },
  {
    id: "settings-logo",
    label: "الإعدادات: تغيير الشعار",
    images: 1,
    async prepare(page) {
      await page.click("nav >> text=السلايدر")
      await page.click("nav >> text=إعدادات الموقع")
      await page.waitForSelector("input[name=name]")
      await page.locator("input[type=file][name=logo]").setInputFiles(photo(1))
    },
    done: { pending: "جارٍ الحفظ…" },
  },
  {
    id: "settings-text",
    label: "الإعدادات: تعديل نص بلا صور",
    images: 0,
    async prepare(page, run) {
      // نغادر الشاشة ثم نعود إليها: النموذج يحتفظ بالصورة المختارة في السيناريو السابق ما دام مفتوحاً
      await page.click("nav >> text=السلايدر")
      await page.click("nav >> text=إعدادات الموقع")
      await page.waitForSelector("input[name=name]")
      await page.locator("input[name=tagline]").fill(`bench ${run}`)
    },
    done: { pending: "جارٍ الحفظ…" },
  },
]

// خط الرفع وخط التنزيل مشتركان بين كل الطلبات: رفعان متزامنان يتقاسمان السرعة (FIFO)،
// فلا تأخذ كل صورة كامل السرعة وحدها كما لو كانت وحدها على الشبكة.
const channel = (bps) => {
  let freeAt = 0
  return async (bytes, extraMs) => {
    const now = Date.now()
    const start = Math.max(now, freeAt)
    freeAt = start + (bytes / bps) * 1000
    await sleep(freeAt - now + extraMs)
  }
}

async function throttle(page) {
  const up = channel(NET.upBps)
  const down = channel(NET.downBps)
  await page.route(
    (url) => url.host.endsWith("r2.cloudflarestorage.com") || url.pathname.startsWith("/manage"),
    async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      const isR2 = url.host.endsWith("r2.cloudflarestorage.com")
      const isAction = !isR2 && req.method() === "POST"
      if (!isR2 && !isAction) return route.continue()
      const size = req.postDataBuffer()?.length ?? 0
      await up(size, NET.rttMs / 2)
      if (isR2) {
        await sleep(NET.rttMs / 2)
        return route.fulfill({ status: 200, headers: { etag: '"bench"', "access-control-allow-origin": "*", "access-control-expose-headers": "etag" }, body: "" })
      }
      const res = await route.fetch()
      const body = await res.body()
      await down(body.length, NET.rttMs / 2)
      return route.fulfill({ response: res, body })
    },
  )
  // طلب الفحص المسبق لـ PUT عبر النطاقات
  await page.route(
    (url) => url.host.endsWith("r2.cloudflarestorage.com"),
    (route) => route.fallback(),
  )
}

async function measure(page, scenario, run) {
  await scenario.prepare(page, run)
  await sleep(400) // استقرار الواجهة بعد اختيار الملفات، لا يُحسب
  const events = []
  let t0 = 0
  const onReq = (req) => {
    const url = new URL(req.url())
    const isR2 = url.host.endsWith("r2.cloudflarestorage.com") && req.method() === "PUT"
    const isAction = url.pathname.startsWith("/manage") && req.method() === "POST"
    if (!isR2 && !isAction) return
    const ev = { kind: isR2 ? "put" : "action", start: Date.now() - t0, end: null, bytes: req.postDataBuffer()?.length ?? 0 }
    events.push(ev)
    req._bench = ev
  }
  // «response» لا «requestfinished»: الطلبات التي تُجاب عبر route.fulfill لا تُطلق الثاني دائماً
  const onResponse = (res) => {
    const req = res.request()
    if (req._bench) req._bench.end = Date.now() - t0
  }
  page.on("request", onReq)
  page.on("response", onResponse)

  await counter(true)
  t0 = Date.now()
  await page.getByRole("button", { name: SAVE }).click()
  if (scenario.done.dialog) await page.waitForSelector("[role=dialog]", { state: "hidden", timeout: 120000 })
  else {
    // الإعدادات بلا نافذة: يعود المدير حين يرجع الزر من «جارٍ الحفظ…» إلى «حفظ التغييرات»
    // (عدّاد الرسائل لا ينفع: تعرض الواجهة رسالة واحدة فقط وتستبدل القديمة)
    await page.getByRole("button", { name: scenario.done.pending }).waitFor({ state: "visible", timeout: 5000 })
    await page.getByRole("button", { name: scenario.done.pending }).waitFor({ state: "hidden", timeout: 120000 })
  }
  const A = Date.now() - t0
  await sleep(1500) // يُكمل after() وإعادة الرسم
  const Q = await counter(false)
  page.off("request", onReq)
  page.off("response", onResponse)

  const done = events.filter((e) => e.end !== null)
  const actions = done.filter((e) => e.kind === "action")
  const puts = done.filter((e) => e.kind === "put")
  const last = actions.length ? actions.reduce((a, b) => (b.end > a.end ? b : a)) : null
  return {
    A,
    B: last ? last.end : A,
    U: puts.length ? Math.max(...puts.map((e) => e.end)) : 0,
    // مدة طلب الحفظ نفسه (آخر إجراء خادم)، ووقت ما قبل أول طلب (الضغط والتحقق)
    SV: last ? last.end - last.start : 0,
    PRE: events.length ? Math.min(...events.map((e) => e.start)) : 0,
    Q,
    actions: actions.length,
    puts: puts.length,
    events,
  }
}

;(async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: VIEWPORT })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))

  await page.goto(BASE + "/manage/login")
  await page.fill("#username", process.env.MANAGE_USERNAME)
  await page.fill("#password", process.env.MANAGE_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(BASE + "/manage", { timeout: 60000 })
  await page.waitForSelector("nav button")
  await throttle(page)

  const results = {}
  for (const sc of SCENARIOS) {
    if (ONLY.length && !ONLY.includes(sc.id)) continue
    const runs = []
    for (let i = 0; i < ROUNDS + WARMUP; i++) {
      try {
        const r = await measure(page, sc, i)
        if (i >= WARMUP) runs.push(r)
        process.stdout.write(`${sc.id} #${i}${i < WARMUP ? " (warmup)" : ""}: A=${r.A} B=${r.B} U=${r.U} PRE=${r.PRE} SV=${r.SV} Q=${r.Q}\n`)
      } catch (e) {
        process.stdout.write(`${sc.id} #${i}: FAILED ${e.message.split("\n")[0]}\n`)
        await page.screenshot({ path: path.join(path.dirname(OUT), `fail-${sc.id}-${i}.png`) }).catch(() => {})
        // نحاول استعادة اللوحة لتكملة بقية التكرارات
        await page.goto(BASE + "/manage").catch(() => {})
        await page.waitForSelector("nav button").catch(() => {})
      }
    }
    const col = (k) => runs.map((r) => r[k])
    results[sc.id] = {
      label: sc.label,
      images: sc.images,
      n: runs.length,
      A: { median: median(col("A")), p95: p95(col("A")) },
      B: { median: median(col("B")), p95: p95(col("B")) },
      U: { median: median(col("U")), p95: p95(col("U")) },
      PRE: { median: median(col("PRE")) },
      SV: { median: median(col("SV")) },
      Q: { median: median(col("Q")) },
      runs,
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({ net: NET, rounds: ROUNDS, errors, results }, null, 2))

  console.log("\n| السيناريو | n | A وسيط | A p95 | B وسيط | B p95 | قبل أول طلب | رفع U | طلب الحفظ | استعلامات |\n|---|---|---|---|---|---|---|---|---|---|")
  for (const r of Object.values(results)) {
    console.log(`| ${r.label} | ${r.n} | ${r.A.median} | ${r.A.p95} | ${r.B.median} | ${r.B.p95} | ${r.PRE.median} | ${r.U.median} | ${r.SV.median} | ${r.Q.median} |`)
  }
  if (errors.length) console.log("\nأخطاء الصفحة:", errors.slice(0, 5))
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
