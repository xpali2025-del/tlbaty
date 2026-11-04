// تحقق في المتصفح من أساس الحفظ (المرحلة 1 من docs/admin-instant-save-plan.md) على خادم إنتاج حقيقي.
// ليس ضمن CI. التشغيل: انظر scripts/bench/README.md للبناء والتشغيل (نفس متغيرات R2 الوهمية)، ثم:
//   set -a; . /tmp/e2e.env; set +a; node scripts/e2e/admin-save-foundation.e2e.mjs
// يحتاج DATABASE_URL (لقراءة الحقيقة من القاعدة) وMANAGE_USERNAME/MANAGE_PASSWORD.
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

// Playwright ليس اعتمادية للمشروع (يأتي مع بيئة التشغيل)، وحلّه عبر NODE_PATH لا يعمل مع import.
const { chromium } = createRequire(import.meta.url)("playwright")

const BASE = process.env.BASE || "http://127.0.0.1:3311"
const sql = (q) => execFileSync("psql", [process.env.DATABASE_URL, "-tAc", q], { encoding: "utf8" }).trim()
// القائمة تعرض الأرقام بالعربية (ar-EG): نقارن بالصيغة نفسها
const ar = (n) => Number(n).toLocaleString("ar-EG")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const ok = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`)
  if (!cond) failed++
}

async function login(context) {
  // هذا الفحص يخص مسار «الانتظار ثم الإغلاق» (الحفظ الفوري للمنتجات يُفحص في save-queue.e2e.mjs)
  await context.addInitScript(() => localStorage.setItem("manage:instant-save", "off"))
  const page = await context.newPage()
  await page.goto(BASE + "/manage/login")
  await page.fill("#username", process.env.MANAGE_USERNAME)
  await page.fill("#password", process.env.MANAGE_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(BASE + "/manage", { timeout: 60000 })
  await page.waitForSelector("nav button")
  return page
}
const openFirstProduct = async (page) => {
  await page.click("nav >> text=المنتجات")
  await page.locator("button:has(span.sr-only:text('تعديل'))").first().click()
  await page.waitForSelector("[role=dialog]")
}
const save = (page) => page.getByRole("button", { name: "حفظ التغييرات" }).click()

;(async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await login(context)
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))

  // ---------- 1) تعديل سعر: القائمة تتحدّث من الرد بلا إعادة تحميل، والمتجر يتحدّث بعد الرد ----------
  await openFirstProduct(page)
  const slug = await page.locator("[role=dialog] input[name=slug]").inputValue()
  const price = String(7000 + Math.floor(Math.random() * 999))
  await page.locator("[role=dialog] input[name=price]").fill(price)
  const rscGets = []
  page.on("request", (r) => r.headers()["rsc"] === "1" && rscGets.push(r.url()))
  const versionBefore = Number(sql(`select version from store.products where slug='${slug}'`))
  await save(page)
  await page.waitForSelector("[role=dialog]", { state: "hidden", timeout: 30000 })
  ok(true, "النافذة أُغلقت بعد الحفظ")
  ok(Number(sql(`select version from store.products where slug='${slug}'`)) === versionBefore + 1, "رقم نسخة المنتج زاد بواحد")
  await page.waitForTimeout(300)
  ok((await page.locator("main").innerText()).includes(ar(price)), `القائمة تعرض السعر الجديد ${price} دون إعادة تحميل`)
  ok(rscGets.length === 0, `لا طلب RSC بعد الحفظ (${rscGets.length})`)

  let storefront = false
  for (let i = 0; i < 20 && !storefront; i++) {
    const html = await (await fetch(`${BASE}/product/${slug}`)).text()
    storefront = html.includes(price)
    if (!storefront) await sleep(250)
  }
  ok(storefront, "صفحة المنتج في المتجر تعرض السعر الجديد (إبطال الكاش بعد الرد يعمل)")

  // ---------- 2) رد ضاع بعد وصول الحفظ: إعادة الإرسال لا تنشئ منتجاً مكرراً ----------
  await page.click("button:has-text('منتج جديد')")
  await page.waitForSelector("[role=dialog]")
  const name = `e2e مكرر ${Date.now()}`
  const dialog = page.locator("[role=dialog]")
  await dialog.locator("input[name=name]").fill(name)
  await dialog.locator("input[name=price]").fill("55")
  await dialog.getByRole("combobox").first().click()
  await page.getByRole("option").first().click()
  let aborted = 0
  await page.route(
    (url) => url.pathname.startsWith("/manage"),
    async (route) => {
      if (route.request().method() !== "POST" || aborted >= 1) return route.continue()
      aborted++
      await route.fetch() // الخادم ينفّذ الحفظ ويُلتزم...
      await route.abort("failed") // ...لكن الرد لا يصل المتصفح
    },
  )
  await save(page)
  await page.getByText("انقطع الاتصال بالخادم").first().waitFor({ timeout: 30000 }).catch(() => {})
  ok(aborted === 1, "الرد الأول أُسقط")
  ok(await page.getByText("انقطع الاتصال بالخادم").first().isVisible().catch(() => false), "ظهرت رسالة انقطاع الاتصال بالعربية")
  ok(Number(sql(`select count(*) from store.products where name='${name}'`)) === 1, "الحفظ الأول التُزم في القاعدة رغم ضياع الرد")
  ok((await dialog.count()) > 0 && (await dialog.isVisible()), "النافذة بقيت مفتوحة ببياناتها")
  await save(page) // المدير يضغط حفظ من جديد: نفس المحتوى = نفس معرّف العملية
  await page.waitForSelector("[role=dialog]", { state: "hidden", timeout: 30000 })
  ok(Number(sql(`select count(*) from store.products where name='${name}'`)) === 1, "إعادة الإرسال لم تُنشئ منتجاً ثانياً")
  ok((await page.locator("main").innerText()).split(name).length - 1 === 1, "القائمة تعرض المنتج مرة واحدة")
  await page.unroute((url) => url.pathname.startsWith("/manage")).catch(() => {})

  // ---------- 3) عدّاد القسم يتحدّث عند فتحه (علّمناه قديماً ولم نعد رسم الصفحة) ----------
  const categoryName = sql(`select c.name from store.products p join store.categories c on c.id=p.category_id where p.name='${name}'`)
  const expectedCount = Number(sql(`select count(*) from store.products p join store.categories c on c.id=p.category_id where c.name='${categoryName}'`))
  await page.click("nav >> text=الأقسام")
  await page.waitForFunction(([n, c]) => document.body.innerText.includes(n) && new RegExp(`${n}[\\s\\S]{0,80}?${c}\\s*منتج`).test(document.body.innerText), [categoryName, expectedCount], { timeout: 15000 }).catch(() => {})
  const text = await page.locator("main").innerText()
  ok(new RegExp(`${categoryName}[\\s\\S]{0,80}?${expectedCount}\\s*منتج`).test(text), `عدّاد منتجات «${categoryName}» صار ${expectedCount}`)

  // ---------- 4) تعارض: مديران يفتحان المنتج نفسه ----------
  const context2 = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page2 = await login(context2)
  await openFirstProduct(page)
  await openFirstProduct(page2)
  const slug2 = await page.locator("[role=dialog] input[name=slug]").inputValue()
  ok(slug2 === (await page2.locator("[role=dialog] input[name=slug]").inputValue()), "المديران فتحا المنتج نفسه")
  await page.locator("[role=dialog] input[name=price]").fill("8001")
  await save(page)
  await page.waitForSelector("[role=dialog]", { state: "hidden", timeout: 30000 })
  await page2.locator("[role=dialog] input[name=price]").fill("8002")
  await save(page2)
  await page2.getByText("عدّل شخص آخر هذا المنتج").first().waitFor({ timeout: 30000 }).catch(() => {})
  ok(await page2.getByText("عدّل شخص آخر هذا المنتج").first().isVisible().catch(() => false), "المدير الثاني رأى رسالة التعارض")
  ok(Number(sql(`select price from store.products where slug='${slug2}'`)) === 8001, "تعديل الأول لم يُمسح (السعر 8001)")
  ok(await page2.locator("[role=dialog]").isVisible(), "نافذة الثاني بقيت مفتوحة ببياناته")
  await page2.keyboard.press("Escape")
  await page2.waitForTimeout(300)
  ok((await page2.locator("main").innerText()).includes(ar(8001)), "قائمة الثاني تحدّثت بآخر نسخة (8001)")

  // ---------- 5) تحديث خلفي بطيء يصل بعد حفظ جديد: لا يستبدل المحفوظ بنسخته القديمة ----------
  // حفظ يعلّم شاشات أخرى قديمة، ففتح المنتجات يبدأ تحديثاً؛ نؤخّر رده 3 ثوانٍ ونحفظ قبل وصوله.
  await openFirstProduct(page)
  const slug3 = await page.locator("[role=dialog] input[name=slug]").inputValue()
  await page.locator("[role=dialog] input[name=price]").fill("9001")
  await save(page)
  await page.waitForSelector("[role=dialog]", { state: "hidden", timeout: 30000 })
  await page.route(
    (url) => url.searchParams.has("_rsc"),
    async (route) => {
      await sleep(3000)
      await route.continue()
    },
  )
  await page.click("nav >> text=المنتجات") // يبدأ التحديث (مؤخَّر)
  await page.locator("button:has(span.sr-only:text('تعديل'))").first().click()
  await page.waitForSelector("[role=dialog]")
  await page.locator("[role=dialog] input[name=price]").fill("9002")
  await save(page)
  await page.waitForSelector("[role=dialog]", { state: "hidden", timeout: 30000 })
  await page.waitForTimeout(4500) // وصل رد التحديث القديم الآن
  ok((await page.locator("main").innerText()).includes(ar(9002)), "بعد وصول التحديث القديم ما زالت القائمة تعرض آخر حفظ (9002)")
  ok(Number(sql(`select price from store.products where slug='${slug3}'`)) === 9002, "القاعدة: 9002")
  await page.locator("button:has(span.sr-only:text('تعديل'))").first().click()
  await page.waitForSelector("[role=dialog]")
  await page.locator("[role=dialog] input[name=price]").fill("9003")
  await save(page)
  await page.waitForSelector("[role=dialog]", { state: "hidden", timeout: 30000 })
  ok(Number(sql(`select price from store.products where slug='${slug3}'`)) === 9003, "التعديل التالي نجح بلا تعارض كاذب (9003)")
  await page.unroute((url) => url.searchParams.has("_rsc")).catch(() => {})

  ok(errors.length === 0, `لا أخطاء في الصفحة ${errors.join(";")}`)
  await browser.close()
  sql(`delete from store.products where name like 'e2e مكرر %'`)
  console.log(failed ? `\n${failed} فحص فشل` : "\nكل الفحوص نجحت")
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
