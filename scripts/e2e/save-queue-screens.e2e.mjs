// تحقق في المتصفح من الحفظ الفوري لبقية الشاشات (المرحلة 5 من docs/admin-instant-save-plan.md) على خادم إنتاج حقيقي.
// ليس ضمن CI. التشغيل: انظر scripts/bench/README.md للبناء والتشغيل (متغيرات R2 الوهمية)، ثم (أعد تشغيل الخادم قبل كل مرة: كابح الدخول في الذاكرة):
//   set -a; . /tmp/e2e.env; set +a; FIXTURES=/tmp/claude-0/perf/fixtures node scripts/e2e/save-queue-screens.e2e.mjs        (1280)
//   WIDTH=375 ...                                                                                                           (هاتف)
// ONLY=الأقسام,البراندات لشاشات بعينها (بأسماء التنقل).
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const { chromium } = createRequire(import.meta.url)("playwright")
const BASE = process.env.BASE || "http://127.0.0.1:3311"
const FIXTURES = process.env.FIXTURES || "/tmp/claude-0/perf/fixtures"
const VIEWPORT = { width: Number(process.env.WIDTH || 1280), height: 900 }
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean)
const sql = (q) => execFileSync("psql", [process.env.DATABASE_URL, "-tAc", q], { encoding: "utf8" }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const RUN = Date.now().toString(36)
let failed = 0
const ok = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`)
  if (!cond) failed++
}

const EDIT = "button:has(span.sr-only:text('تعديل')), button[aria-label='تعديل']"
const isManage = (url) => url.pathname.startsWith("/manage")
const CORS = { "access-control-allow-origin": "*", "access-control-expose-headers": "etag" }
const r2 = { puts: 0 }
const dialog = (page) => page.locator("[role=dialog]")
const submit = (page) => page.getByRole("button", { name: "حفظ التغييرات" })
const photo = `${FIXTURES}/photo-1.jpg`

async function login(context) {
  const page = await context.newPage()
  await page.route(
    (url) => url.host.endsWith("r2.cloudflarestorage.com"),
    (route) => {
      if (route.request().method() !== "PUT") return route.fulfill({ status: 204, headers: CORS })
      r2.puts++
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

// لكل شاشة: كيف تُفتح وتُملأ، وكيف نعدّ صفوفها في القاعدة
const SCREENS = [
  { nav: "الأقسام", add: "قسم جديد", count: (l) => `select count(*) from store.categories where name='${l}'`, fill: async (d, l) => d.locator("input[name=name]").fill(l) },
  { nav: "البراندات", add: "براند جديد", count: (l) => `select count(*) from store.brands where name='${l}'`, fill: async (d, l) => d.locator("input[name=name]").fill(l) },
  { nav: "السلايدر", add: "سلايد جديد", image: true, count: (l) => `select count(*) from store.slides where title='${l}'`, fill: async (d, l) => d.locator("input[name=title]").fill(l) },
  {
    nav: "أكواد الخصم", add: "كوبون جديد", upper: true, count: (l) => `select count(*) from store.coupons where code='${l.toUpperCase()}'`,
    fill: async (d, l) => {
      await d.locator("input[name=code]").fill(l)
      await d.locator("input[name=discount]").fill("10")
      await d.locator("input[name=description]").fill("e2e")
    },
  },
  {
    nav: "آراء العملاء", add: "تقييم جديد", count: (l) => `select count(*) from store.reviews where name='${l}'`,
    fill: async (d, l) => {
      await d.locator("input[name=name]").fill(l)
      await d.locator("textarea[name=comment]").fill("ممتاز")
    },
  },
  { nav: "الإعلانات", add: "إعلان جديد", image: true, count: (l) => `select count(*) from store.ads where title='${l}'`, fill: async (d, l) => d.locator("input[name=title]").fill(l) },
  {
    nav: "حسابات الدفع", add: "حساب جديد", count: (l) => `select count(*) from store.payment_accounts where provider_name='${l}'`,
    fill: async (d, l) => {
      await d.locator("input[name=providerName]").fill(l)
      await d.locator("input[name=accountHolderName]").fill("e2e")
      await d.locator("input[name=accountNumber]").fill("123456")
    },
  },
].filter((s) => !ONLY.length || ONLY.includes(s.nav))

let seq = 0
// ثابت الطول وينتهي بحرف: لا يكون اسم بادئة لاسم آخر (نص الصف يلصق بعده عدّاداً مثل «0 منتج»)
const labelFor = (s) => { const n = String(++seq).padStart(3, "0"); return s.upper ? `E2E${RUN}${n}Z`.toUpperCase() : `e2e-${RUN}-${n}z` }
const row = (page, text) => page.locator("[data-testid=item-row]", { hasText: text })
const stateOf = (page, text) => row(page, text).first().getAttribute("data-save-state")
const rowText = (s, l) => (s.upper ? l.toUpperCase() : l)

async function openAndFill(page, s, label) {
  await page.click(`button:has-text('${s.add}')`)
  await dialog(page).waitFor()
  await s.fill(dialog(page), label)
  if (s.image) {
    await dialog(page).locator("input[type=file][name=image]").setInputFiles(photo)
    // الرفع المسبق يبدأ عند الاختيار: ننتظر اكتماله ليكون ما نختبره الحفظ لا الرفع
    await page.waitForFunction(() => {
      const els = [...document.querySelectorAll("[role=dialog] [data-upload-state]")]
      return els.length >= 1 && els.every((e) => e.getAttribute("data-upload-state") === "done")
    }, null, { timeout: 30000 })
  }
}

async function waitSaved(page, s, label, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const count = await row(page, rowText(s, label)).count()
    // «saved» تبقى لحظة حتى تصل البيانات؛ نقبل أن يكون الصف الحقيقي وحده ظاهراً (بلا عملية) أيضاً
    if (count === 1 && (await stateOf(page, rowText(s, label))) === "saved" && Number(sql(s.count(label))) === 1) {
      const gone = await page.waitForFunction((t) => [...document.querySelectorAll("[data-testid=item-row]")].filter((e) => e.textContent.includes(t)).length === 1 && !document.querySelector("[data-testid=save-status-working]"), rowText(s, label), { timeout: 8000 }).then(() => true, () => false)
      if (gone) return true
    }
    await sleep(150)
  }
  const info = await page.evaluate((t) => [...document.querySelectorAll("[data-testid=item-row]")].filter((e) => e.textContent.includes(t)).map((e) => e.getAttribute("data-save-state") + "|" + e.textContent.slice(0, 60)), rowText(s, label))
  const idb = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("tajline-save-queue"); r.onsuccess = () => { const g = r.result.transaction("jobs").objectStore("jobs").getAll(); g.onsuccess = () => res(g.result.map((j) => `${j.state}:${j.label}`)) } })).catch(() => "?")
  console.log(`   (IndexedDB: ${JSON.stringify(idb)})`)
  console.log(`   (تشخيص: حالات الصفوف ${JSON.stringify(info)}، قاعدة ${sql(s.count(label))}، شريط ${await page.getByTestId("save-status").count()})`)
  return false
}

async function armCloseTimer(page) {
  await page.evaluate(() => {
    window.__closeMs = null
    const button = document.querySelector("[role=dialog] button[type=submit]")
    button.addEventListener(
      "click",
      () => {
        const t0 = performance.now()
        const done = () => {
          const d = document.querySelector("[role=dialog]")
          if (!d || d.getAttribute("data-state") === "closed") {
            window.__closeMs = performance.now() - t0
            observer.disconnect()
          }
        }
        const observer = new MutationObserver(done)
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] })
      },
      { once: true, capture: true },
    )
  })
}

;(async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: VIEWPORT })
  const page = await login(context)
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  console.log(`— العرض ${VIEWPORT.width}px —`)

  for (const s of SCREENS) {
    console.log(`\n## ${s.nav}`)
    await page.click(`nav >> text=${s.nav}`)
    await page.waitForSelector(`button:has-text('${s.add}')`)

    // 1) سرعة إغلاق النافذة (p95 من 6) وأن كل الحفظات تصل
    const times = []
    const labels = []
    for (let i = 0; i < 6; i++) {
      const label = labelFor(s)
      labels.push(label)
      await openAndFill(page, s, label)
      await armCloseTimer(page)
      await submit(page).click()
      await page.waitForFunction(() => window.__closeMs !== null, null, { timeout: 5000 })
      times.push(await page.evaluate(() => window.__closeMs))
      await dialog(page).waitFor({ state: "hidden" })
    }
    times.sort((a, b) => a - b)
    const p95 = times[Math.ceil(times.length * 0.95) - 1]
    ok(p95 < 100, `النافذة تُغلق خلال ${p95.toFixed(1)}ms (p95 من 6؛ الشرط أقل من 100)`)
    const drained = await page.waitForFunction(() => !document.querySelector("[data-testid=save-status]") && ![...document.querySelectorAll("[data-testid=item-row]")].some((e) => e.getAttribute("data-save-state") !== "saved"), null, { timeout: 90000 }).then(() => true, () => false)
    ok(drained, "كل الحفظات الستة اكتملت وانتهى الشريط")
    ok(labels.every((l) => Number(sql(s.count(l))) === 1), "كل عنصر في القاعدة مرة واحدة")

    // 2) العنصر يظهر فوراً بشارة، ثم يستقر
    const slow = async (route) => {
      if (route.request().method() === "POST") await sleep(1500)
      return route.continue()
    }
    await page.route(isManage, slow)
    const l2 = labelFor(s)
    await openAndFill(page, s, l2)
    await submit(page).click()
    await dialog(page).waitFor({ state: "hidden", timeout: 2000 })
    ok((await row(page, rowText(s, l2)).count()) === 1, "العنصر ظهر في القائمة فور الضغط والخادم لم يرد")
    ok(["queued", "running"].includes(await stateOf(page, rowText(s, l2))), "عليه شارة «جارٍ الحفظ»")
    ok(Number(sql(s.count(l2))) === 0, "لم يُحفظ في القاعدة بعد (الرد مؤخَّر عمداً)")
    ok(await waitSaved(page, s, l2), "استقر: صف واحد حقيقي في القائمة ومرة واحدة في القاعدة")
    await page.unroute(isManage, slow)

    // 3) انقطاع الشبكة ثم عودتها
    const l3 = labelFor(s)
    await openAndFill(page, s, l3)
    await context.setOffline(true)
    await submit(page).click()
    await dialog(page).waitFor({ state: "hidden", timeout: 2000 })
    await page.getByTestId("save-status-waiting").waitFor({ timeout: 15000 })
    ok((await row(page, rowText(s, l3)).count()) === 1, "انقطع الاتصال: العنصر باقٍ في القائمة والشريط يقول «بانتظار الاتصال»")
    await context.setOffline(false)
    ok(await waitSaved(page, s, l3, 40000), "عاد الاتصال فاكتمل الحفظ مرة واحدة")

    // 4) رد ضاع بعد أن التزم الخادم
    const l4 = labelFor(s)
    let aborted = 0
    const lose = async (route) => {
      if (route.request().method() !== "POST" || aborted >= 1) return route.continue()
      aborted++
      await route.fetch()
      await route.abort("failed")
    }
    await openAndFill(page, s, l4)
    await page.route(isManage, lose) // بعد اكتمال الرفع المسبق: المطلوب إسقاط رد الحفظ لا رد توقيع الرفع
    await submit(page).click()
    ok(await waitSaved(page, s, l4, 40000) && aborted === 1, "رد ضاع بعد الالتزام: أُعيد الإرسال واستقر")
    ok(Number(sql(s.count(l4))) === 1, "ومع ذلك صف واحد فقط في القاعدة (لا تكرار)")
    await page.unroute(isManage, lose)

    // 5) تحديث الصفحة أثناء الحفظ
    const l5 = labelFor(s)
    const hold = (route) => (route.request().method() === "POST" ? new Promise(() => {}) : route.continue())
    await openAndFill(page, s, l5)
    await page.route(isManage, hold)
    await submit(page).click()
    await dialog(page).waitFor({ state: "hidden", timeout: 2000 })
    await sleep(700)
    ok(Number(sql(s.count(l5))) === 0, "الطلب عالق ولم يصل الخادم")
    await page.unroute(isManage, hold)
    page.once("dialog", (d) => d.accept())
    await page.reload()
    await page.waitForSelector(`button:has-text('${s.add}')`)
    ok(await waitSaved(page, s, l5, 40000), "بعد التحديث استُؤنفت العملية واكتملت")
    ok(Number(sql(s.count(l5))) === 1, "مرة واحدة في القاعدة")

    // 6) تعديل عنصر موجود يظهر فوراً
    const first = row(page, rowText(s, labels[0])).first()
    await first.locator(EDIT).click()
    await dialog(page).waitFor()
    const edited = labelFor(s)
    await s.fill(dialog(page), edited)
    await submit(page).click()
    await dialog(page).waitFor({ state: "hidden", timeout: 2000 })
    ok((await row(page, rowText(s, edited)).count()) >= 1, "التعديل ظهر في القائمة فوراً")
    ok(await waitSaved(page, s, edited, 40000), "واستقر")
    ok(Number(sql(s.count(labels[0]))) === 0, "الاسم القديم زال من القاعدة (تعديل لا إنشاء)")
  }

  // رفض الخادم: كوبون بكود مكرر ثم تصحيحه
  if (!ONLY.length || ONLY.includes("أكواد الخصم")) {
    console.log("\n## رفض الخادم (كوبون مكرر)")
    const s = SCREENS.find((x) => x.nav === "أكواد الخصم")
    await page.click(`nav >> text=${s.nav}`)
    const base = labelFor(s)
    await openAndFill(page, s, base)
    await submit(page).click()
    ok(await waitSaved(page, s, base), "كوبون أول محفوظ")
    const dup = base
    await page.click(`button:has-text('${s.add}')`)
    await dialog(page).waitFor()
    await s.fill(dialog(page), dup)
    await submit(page).click()
    await page.locator("[data-testid=save-problem]").first().waitFor({ timeout: 20000 })
    ok((await page.locator("[data-testid=item-row][data-save-state=failed]").count()) === 1, "العنصر المرفوض صار أحمر")
    ok((await page.locator("[data-testid=item-row][data-save-state=failed]").innerText()).includes("مستخدم بالفعل"), "ويعرض سبب الرفض بالعربية")
    ok(await page.getByTestId("save-status-problems").isVisible(), "الشريط يعرض «فشل حفظ 1 — عرض»")
    await page.locator("[data-testid=item-row][data-save-state=failed]").locator(EDIT).click()
    await dialog(page).waitFor()
    const fixed = labelFor(s)
    await dialog(page).locator("input[name=code]").fill(fixed)
    await submit(page).click()
    ok(await waitSaved(page, s, fixed), "بعد تصحيح الكود اكتمل الحفظ")
    ok((await page.locator("[data-testid=item-row][data-save-state=failed]").count()) === 0, "اختفى العنصر الأحمر")
  }

  // إعلان فيديو: الفيديو وغلافه المستخرج يُسلَّمان للطابور بعد أن بدأ رفعهما، فتُغلق النافذة فوراً ويكتمل الحفظ في الخلفية
  if (!ONLY.length || ONLY.includes("الإعلانات")) {
    console.log("\n## إعلان فيديو")
    const adsScreen = SCREENS.find((x) => x.nav === "الإعلانات")
    await page.click("nav >> text=الإعلانات")
    await page.click("button:has-text('إعلان جديد')")
    await dialog(page).waitFor()
    await dialog(page).locator("[role=radio]:has-text('فيديو')").click()
    const vlabel = labelFor({})
    await dialog(page).locator("input[name=title]").fill(vlabel)
    const putsBefore = r2.puts
    const pendingBefore = Number(sql("select count(*) from store.pending_uploads")) // رفع مسبق ضاع بتحديث صفحة سابق يبقى لتنظيف الـ24 ساعة
    await dialog(page).locator("input[type=file][accept='video/mp4']").setInputFiles(`${FIXTURES}/ad-test.mp4`)
    await page.getByText("رُفع الفيديو").first().waitFor({ timeout: 30000 })
    const t = Date.now()
    while (r2.puts < putsBefore + 2 && Date.now() - t < 15000) await sleep(100) // الفيديو وغلافه المستخرج
    ok(r2.puts === putsBefore + 2, `الفيديو وغلافه رُفعا قبل الحفظ (PUT: ${r2.puts - putsBefore})`)
    await armCloseTimer(page)
    await submit(page).click()
    await page.waitForFunction(() => window.__closeMs !== null, null, { timeout: 5000 })
    const closeMs = await page.evaluate(() => window.__closeMs)
    ok(closeMs < 100, `نافذة إعلان الفيديو تُغلق خلال ${closeMs.toFixed(1)}ms`)
    ok(await waitSaved(page, adsScreen, vlabel, 40000), "حُفظ الإعلان في الخلفية")
    ok(r2.puts === putsBefore + 2, `لم يُرفع شيء ثانية عند الحفظ (PUT: ${r2.puts - putsBefore})`)
    ok(Number(sql(`select count(*) from store.ads where title='${vlabel}' and kind='video' and video_key is not null and image_key is not null`)) === 1, "في القاعدة: إعلان فيديو بمفتاح فيديو وغلاف")
    ok(Number(sql("select count(*) from store.pending_uploads")) === pendingBefore, "طُولب بمفاتيح الفيديو والغلاف بعد الحفظ فلم يبقَ معلّق جديد")
  }

  // الإعدادات: صفحة بلا نافذة؛ يعود الزر فوراً والحفظ يكمل في الخلفية، ويصمد أمام الانقطاع
  if (!ONLY.length || ONLY.includes("إعدادات الموقع")) {
    console.log("\n## إعدادات الموقع")
    await page.click("nav >> text=إعدادات الموقع")
    const tagline = page.locator("input[name=tagline]").first()
    await tagline.waitFor()
    const original = await tagline.inputValue()
    const slow = async (route) => {
      if (route.request().method() === "POST") await sleep(1500)
      return route.continue()
    }
    await page.route(isManage, slow)
    const v1 = `شعار-${RUN}-1`
    await tagline.fill(v1)
    const t0 = Date.now()
    await page.getByRole("button", { name: "حفظ التغييرات" }).click()
    await page.getByTestId("settings-save").waitFor({ timeout: 2000 })
    ok(Date.now() - t0 < 1000, `عاد الزر والشريط يعرض الحفظ فوراً (${Date.now() - t0}ms) والخادم لم يرد`)
    ok(sql("select tagline from store.site_settings") !== v1, "لم يُحفظ في القاعدة بعد (الرد مؤخَّر عمداً)")
    const end = Date.now() + 20000
    while (Date.now() < end && sql("select tagline from store.site_settings") !== v1) await sleep(200)
    ok(sql("select tagline from store.site_settings") === v1, "اكتمل الحفظ في الخلفية")
    await page.unroute(isManage, slow)
    await page.waitForFunction(() => !document.querySelector("[data-testid=settings-save]"), null, { timeout: 15000 })
    ok(true, "اختفت شارة الحفظ بعد وصول البيانات")

    const v2 = `شعار-${RUN}-2`
    await tagline.fill(v2)
    await context.setOffline(true)
    await page.getByRole("button", { name: "حفظ التغييرات" }).click()
    await page.getByTestId("save-status-waiting").waitFor({ timeout: 15000 })
    ok(sql("select tagline from store.site_settings") === v1, "انقطع الاتصال: الحفظ الجديد بانتظار الاتصال")
    await context.setOffline(false)
    const end2 = Date.now() + 40000
    while (Date.now() < end2 && sql("select tagline from store.site_settings") !== v2) await sleep(200)
    ok(sql("select tagline from store.site_settings") === v2, "عاد الاتصال فاكتمل الحفظ")
    // رفض: رقم هاتف غير صالح يُرفض في المتصفح قبل أي إغلاق
    await page.locator("input[name=phone]").first().fill("abc")
    await page.getByRole("button", { name: "حفظ التغييرات" }).click()
    await sleep(500)
    ok(!(await page.getByTestId("settings-save").count()), "مدخل غير صالح يُرفض في المتصفح ولا يدخل الطابور")
    await page.reload()
    await tagline.waitFor()
    await tagline.fill(original)
    await page.getByRole("button", { name: "حفظ التغييرات" }).click()
    const end3 = Date.now() + 20000
    while (Date.now() < end3 && sql("select coalesce(tagline,'') from store.site_settings") !== original) await sleep(200)
  }

  ok(errors.length === 0, `لا أخطاء جافاسكربت في الصفحة${errors.length ? ": " + errors[0] : ""}`)
  await browser.close()
  console.log(failed ? `\n✗ ${failed} فشل` : "\n✓ كل الفحوص نجحت")
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
