// تحقق في المتصفح من طابور الحفظ للمنتجات (المرحلة 4 من docs/admin-instant-save-plan.md) على خادم إنتاج حقيقي.
// ليس ضمن CI. التشغيل: انظر scripts/bench/README.md للبناء والتشغيل (متغيرات R2 الوهمية)، ثم:
//   set -a; . /tmp/e2e.env; set +a; node scripts/e2e/save-queue.e2e.mjs         (1280)
//   set -a; . /tmp/e2e.env; set +a; WIDTH=375 node scripts/e2e/save-queue.e2e.mjs (هاتف)
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const { chromium } = createRequire(import.meta.url)("playwright")
const FIXTURES = process.env.FIXTURES || "/tmp/claude-0/perf/fixtures"
const BASE = process.env.BASE || "http://127.0.0.1:3311"
const VIEWPORT = { width: Number(process.env.WIDTH || 1280), height: 900 }
const sql = (q) => execFileSync("psql", [process.env.DATABASE_URL, "-tAc", q], { encoding: "utf8" }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const RUN = Date.now().toString(36)
let failed = 0
const ok = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`)
  if (!cond) failed++
}
const countByName = (name) => Number(sql(`select count(*) from store.products where name='${name}'`))

// R2 وهمي: يعترض الـ PUT ويردّ 200 ويعدّه.
const r2 = { puts: 0 }
const CORS = { "access-control-allow-origin": "*", "access-control-expose-headers": "etag" }

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
  await page.click("nav >> text=المنتجات")
  await page.waitForSelector("[data-testid=product-row]")
  return page
}

const isManage = (url) => url.pathname.startsWith("/manage")
const dialog = (page) => page.locator("[role=dialog]")
const row = (page, name) => page.locator("[data-testid=product-row]", { hasText: name })
const submit = (page) => page.getByRole("button", { name: "حفظ التغييرات" })
const rowState = (page, name) => row(page, name).first().getAttribute("data-save-state")

let seq = 0
async function fillNew(page, name, { slug = `e2e-${RUN}-${++seq}`, price = "55" } = {}) {
  await page.click("button:has-text('منتج جديد')")
  await dialog(page).waitFor()
  await dialog(page).locator("input[name=name]").fill(name)
  await dialog(page).locator("input[name=price]").fill(price)
  await dialog(page).locator("input[name=slug]").fill(slug)
  await dialog(page).getByRole("combobox").first().click()
  await page.getByRole("option").first().click()
}

/** يقيس من الضغط على «حفظ» حتى تُغلق النافذة (data-state=closed أو زوالها) داخل الصفحة نفسها، بلا زمن Playwright. */
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

async function waitSaved(page, name, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if ((await row(page, name).count()) === 1 && (await rowState(page, name)) === "saved") return true
    await sleep(150)
  }
  return false
}

;(async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: VIEWPORT })
  const page = await login(context)
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  console.log(`— العرض ${VIEWPORT.width}px —`)

  // ---------- 1) النافذة تُغلق بسرعة: p95 من 20 مرة ----------
  const times = []
  for (let i = 0; i < 20; i++) {
    await page.locator("button:has(span.sr-only:text('تعديل'))").first().click()
    await dialog(page).waitFor()
    await dialog(page).locator("input[name=price]").fill(String(300 + i))
    await armCloseTimer(page)
    await submit(page).click()
    await page.waitForFunction(() => window.__closeMs !== null, null, { timeout: 5000 })
    times.push(await page.evaluate(() => window.__closeMs))
    await dialog(page).waitFor({ state: "hidden" })
  }
  times.sort((a, b) => a - b)
  const p95 = times[Math.ceil(times.length * 0.95) - 1]
  ok(p95 < 100, `النافذة تُغلق خلال ${p95.toFixed(1)}ms (p95 من 20؛ الوسيط ${times[10].toFixed(1)}ms؛ الشرط أقل من 100)`)
  // كل الحفظات تصل في النهاية
  const drained = await page.waitForFunction(() => !document.querySelector("[data-testid=save-status]"), null, { timeout: 60000 }).then(() => true, () => false)
  ok(drained, "كل الحفظات العشرين اكتملت وانتهى الشريط (بلا تعارض كاذب بين تعديلات متتابعة على المنتج نفسه)")
  ok((await page.locator("[data-save-state=conflict],[data-save-state=failed]").count()) === 0, "لا عنصر أحمر بعد التعديلات المتتابعة")

  // ---------- 2) عنصر يظهر فوراً بشارة «جارٍ الحفظ» ثم يستقر ----------
  const slow = async (route) => {
    if (route.request().method() === "POST") await sleep(1800)
    return route.continue()
  }
  await page.route(isManage, slow)
  const name2 = `e2e-فوري-${RUN}`
  await fillNew(page, name2)
  await submit(page).click()
  await dialog(page).waitFor({ state: "hidden", timeout: 2000 })
  ok((await row(page, name2).count()) === 1, "المنتج الجديد ظهر في القائمة فور الضغط، والخادم لم يرد بعد")
  ok(["queued", "running"].includes(await rowState(page, name2)), "عليه شارة حالة «جارٍ الحفظ»")
  ok(await page.getByTestId("save-status-working").isVisible(), "شريط الرأس يعرض «جارٍ حفظ…»")
  ok(countByName(name2) === 0, "لم يُحفظ في القاعدة بعد (الرد مؤخَّر عمداً)")
  ok(await waitSaved(page, name2), "استقر العنصر على «محفوظ» ونسخة الخادم بدل المتفائلة")
  ok(countByName(name2) === 1, "منتج واحد في القاعدة")
  ok(/\w+-\d+/.test(await row(page, name2).first().innerText()), "ظهر رقم المنتج المولَّد من الخادم على العنصر")
  await page.unroute(isManage, slow)
  ok(!(await page.getByTestId("save-status").count()), "اختفى الشريط بعد الاكتمال")

  // ---------- 3) انقطاع الشبكة أثناء الحفظ: يبقى معلّقاً ويكتمل مرة واحدة عند العودة ----------
  const name3 = `e2e-انقطاع-${RUN}`
  await fillNew(page, name3)
  await context.setOffline(true)
  await submit(page).click()
  await dialog(page).waitFor({ state: "hidden", timeout: 2000 })
  await page.getByTestId("save-status-waiting").waitFor({ timeout: 15000 })
  ok(true, "الشريط يقول إن الحفظ بانتظار الاتصال (لن يضيع شيء)")
  ok((await row(page, name3).count()) === 1 && (await rowState(page, name3)) !== "saved", "العنصر باقٍ في القائمة معلّقاً")
  await context.setOffline(false)
  ok(await waitSaved(page, name3, 40000), "عاد الاتصال فاكتمل الحفظ")
  ok(countByName(name3) === 1, "محفوظ مرة واحدة فقط")

  // رد ضاع بعد أن التزم الخادم بالحفظ: إعادة المحاولة بالمعرّف نفسه لا تكرّر
  const name3b = `e2e-ردضائع-${RUN}`
  let aborted = 0
  const lose = async (route) => {
    if (route.request().method() !== "POST" || aborted >= 1) return route.continue()
    aborted++
    await route.fetch()
    await route.abort("failed")
  }
  await page.route(isManage, lose)
  await fillNew(page, name3b)
  await submit(page).click()
  ok(await waitSaved(page, name3b, 40000), "الرد الأول ضاع بعد الالتزام، فأُعيد الإرسال واستقر العنصر")
  ok(aborted === 1 && countByName(name3b) === 1, "ومع ذلك منتج واحد فقط في القاعدة (لا تكرار)")
  await page.unroute(isManage, lose)

  // ---------- 4) تحديث الصفحة أثناء الحفظ: يستأنف بعد التحميل ويكتمل مرة واحدة ----------
  const name4 = `e2e-تحديث-${RUN}`
  const hold = (route) => (route.request().method() === "POST" ? new Promise(() => {}) : route.continue())
  await page.route(isManage, hold)
  await fillNew(page, name4)
  await submit(page).click()
  await dialog(page).waitFor({ state: "hidden", timeout: 2000 })
  await sleep(600) // يُكتب في IndexedDB قبل الإرسال
  ok(countByName(name4) === 0, "الطلب عالق ولم يصل الخادم")
  await page.unroute(isManage, hold)
  page.once("dialog", (d) => d.accept()) // تحذير الإغلاق
  await page.reload()
  await page.waitForSelector("[data-testid=product-row]")
  const restored = (await row(page, name4).count()) === 1
  ok(restored || countByName(name4) === 1, "بعد التحديث العملية موجودة (ظاهرة في القائمة أو اكتملت)")
  ok(await waitSaved(page, name4, 40000), "العملية استُؤنفت بعد التحديث واكتملت")
  ok(countByName(name4) === 1, "محفوظة مرة واحدة")

  // ---------- 5) رفض الخادم: عنصر أحمر بسببه، تعديل وإعادة محاولة، ولا شيء يضيع ----------
  const base5 = `e2e-رفض-${RUN}`
  const slug5 = `rej-${RUN}`
  await fillNew(page, base5, { slug: slug5 })
  await submit(page).click()
  ok(await waitSaved(page, base5), "منتج أول محفوظ برابط معيّن")
  const name5 = `e2e-رفض-ثانٍ-${RUN}`
  await fillNew(page, name5, { slug: slug5, price: "77" }) // الرابط مستخدم: يرفضه الخادم
  await submit(page).click()
  await row(page, name5).locator("[data-testid=save-problem]").waitFor({ timeout: 20000 })
  ok((await rowState(page, name5)) === "failed", "العنصر صار أحمر")
  ok((await row(page, name5).innerText()).includes("هذا الرابط (slug) مستخدم"), "ويعرض سبب الرفض بالعربية")
  ok(await page.getByTestId("save-status-problems").isVisible(), "الشريط يعرض «فشل حفظ 1 — عرض»")
  ok(countByName(name5) === 0, "لم يُحفظ في القاعدة")
  await row(page, name5).getByRole("button", { name: "أعد المحاولة" }).click()
  await row(page, name5).locator("[data-testid=save-problem]").waitFor({ timeout: 20000 })
  ok((await rowState(page, name5)) === "failed", "إعادة المحاولة تعيد عرض السبب نفسه ما دام لم يُصلَح")
  await row(page, name5).locator("button:has(span.sr-only:text('تعديل'))").click()
  await dialog(page).waitFor()
  ok((await dialog(page).locator("input[name=name]").inputValue()) === name5 && (await dialog(page).locator("input[name=price]").inputValue()) === "77", "«تعديل» يفتح النموذج بما كتبه المدير (لم يضع شيء)")
  await dialog(page).locator("input[name=slug]").fill(`${slug5}-b`)
  await submit(page).click()
  ok(await waitSaved(page, name5), "بعد تصحيح الرابط اكتمل الحفظ")
  ok(countByName(name5) === 1 && (await row(page, name5).count()) === 1, "منتج واحد، والعنصر الأحمر القديم اختفى")

  // ---------- 6) تعارض: تبويبان يعدّلان المنتج نفسه ----------
  const name6 = `e2e-تعارض-${RUN}`
  await fillNew(page, name6, { price: "60" })
  await submit(page).click()
  ok(await waitSaved(page, name6), "منتج للتعارض محفوظ")
  const context2 = await browser.newContext({ viewport: VIEWPORT })
  const page2 = await login(context2)
  await row(page2, name6).locator("button:has(span.sr-only:text('تعديل'))").click()
  await dialog(page2).waitFor() // التبويب الثاني فتح النموذج بنسخة قديمة بعد قليل
  await row(page, name6).locator("button:has(span.sr-only:text('تعديل'))").click()
  await dialog(page).waitFor()
  await dialog(page).locator("input[name=price]").fill("61")
  await submit(page).click()
  ok(await waitSaved(page, name6), "التبويب الأول حفظ تعديله")
  await dialog(page2).locator("input[name=price]").fill("62")
  await submit(page2).click()
  await row(page2, name6).locator("[data-testid=save-problem]").waitFor({ timeout: 20000 })
  ok((await rowState(page2, name6)) === "conflict", "التبويب الثاني: العنصر في حالة تعارض")
  const keepBtn = row(page2, name6).getByRole("button", { name: "احتفظ بتعديلي" })
  const takeBtn = row(page2, name6).getByRole("button", { name: "خذ النسخة الجديدة" })
  ok(await keepBtn.waitFor({ timeout: 5000 }).then(() => takeBtn.waitFor({ timeout: 5000 })).then(() => true, () => false), "يعرض الخيارين «احتفظ بتعديلي» و«خذ النسخة الجديدة»")
  ok(sql(`select price from store.products where name='${name6}'`) === "61.00" || sql(`select price from store.products where name='${name6}'`).startsWith("61"), "تعديل الأول لم يُمسح")
  await page2.getByRole("button", { name: "احتفظ بتعديلي" }).click()
  ok(await waitSaved(page2, name6), "«احتفظ بتعديلي» حفظ تعديل الثاني فوق نسخة الأول")
  ok(sql(`select price from store.products where name='${name6}'`).startsWith("62"), "السعر في القاعدة صار 62")
  // الخيار الآخر: خذ النسخة الجديدة
  await page.reload()
  await page.waitForSelector("[data-testid=product-row]")
  await row(page, name6).locator("button:has(span.sr-only:text('تعديل'))").click()
  await dialog(page).waitFor()
  await dialog(page).locator("input[name=price]").fill("63")
  await page2.reload()
  await page2.waitForSelector("[data-testid=product-row]")
  await row(page2, name6).locator("button:has(span.sr-only:text('تعديل'))").click()
  await dialog(page2).waitFor()
  await dialog(page2).locator("input[name=price]").fill("64")
  await submit(page).click()
  ok(await waitSaved(page, name6), "حفظ ثالث (63) نجح")
  await submit(page2).click()
  await row(page2, name6).locator("[data-testid=save-problem]").waitFor({ timeout: 20000 })
  await page2.getByRole("button", { name: "خذ النسخة الجديدة" }).click()
  await sleep(300)
  const shownPrice = await row(page2, name6).locator("p.font-semibold").innerText().catch(() => "") // مخفي على الهاتف (sm فأعلى فقط)
  ok((await rowState(page2, name6)) === "saved" && (VIEWPORT.width < 640 || shownPrice.includes("٦٣")), "«خذ النسخة الجديدة» أبقى نسخة الخادم (63) وأزال التعارض")
  ok(sql(`select price from store.products where name='${name6}'`).startsWith("63"), "القاعدة لم تتغيّر بتعديل المهمَل")
  await context2.close()

  // ---------- 7) إغلاق التبويب وفيه حفظ معلّق: تحذير المتصفح ----------
  const name7 = `e2e-إغلاق-${RUN}`
  await page.route(isManage, hold)
  await fillNew(page, name7)
  await submit(page).click()
  await dialog(page).waitFor({ state: "hidden", timeout: 2000 })
  await sleep(300)
  let warned = false
  page.on("dialog", (d) => {
    if (d.type() === "beforeunload") warned = true
    void d.dismiss()
  })
  await page.close({ runBeforeUnload: true })
  await sleep(500)
  ok(warned, "المتصفح حذّر من إغلاق الصفحة وفيها حفظ لم ينتهِ")

  // ---------- 8) مفتاح الرجوع: إيقاف الحفظ الفوري يعيد السلوك القديم ----------
  const page3 = await login(await browser.newContext({ viewport: VIEWPORT }))
  await page3.getByTestId("instant-save-toggle").click()
  const name8 = `e2e-قديم-${RUN}`
  await fillNew(page3, name8)
  await page3.route(isManage, slow)
  await submit(page3).click()
  await sleep(500)
  ok(await dialog(page3).isVisible(), "الحفظ الفوري موقوف: النافذة تنتظر الخادم كالسابق")
  await dialog(page3).waitFor({ state: "hidden", timeout: 30000 })
  ok(countByName(name8) === 1 && (await rowState(page3, name8)) === "saved", "ثم أُغلقت بعد اكتمال الحفظ، والعنصر محفوظ بلا شارة")
  await page3.getByTestId("instant-save-toggle").click()

  // ---------- 9) صور: الرفع المسبق يُسلَّم للطابور ولا يُعاد رفعه ولا يُحذف عند إغلاق النافذة ----------
  const name9 = `e2e-صور-${RUN}`
  await fillNew(page3, name9)
  await page3.getByTestId("instant-save-toggle").waitFor()
  if ((await page3.getByTestId("instant-save-toggle").getAttribute("aria-checked")) !== "true") await page3.getByTestId("instant-save-toggle").click()
  const before9 = r2.puts
  await dialog(page3).locator("input[type=file][name=image]").setInputFiles(`${FIXTURES}/photo-1.jpg`)
  await dialog(page3).locator("input[type=file][name=newImages]").setInputFiles([`${FIXTURES}/photo-2.jpg`])
  await page3.waitForFunction(() => {
    const els = [...document.querySelectorAll("[role=dialog] [data-upload-state]")]
    return els.length >= 2 && els.every((e) => e.getAttribute("data-upload-state") === "done")
  }, null, { timeout: 30000 })
  ok(r2.puts - before9 === 2, "الصورتان رُفعتا إلى R2 فور اختيارهما")
  await submit(page3).click()
  await dialog(page3).waitFor({ state: "hidden", timeout: 2000 })
  ok(await waitSaved(page3, name9, 40000), "الحفظ في الخلفية اكتمل")
  ok(r2.puts - before9 === 2, `لم تُرفع الصور ثانية عند الحفظ (PUT: ${r2.puts - before9})`)
  ok(Number(sql(`select count(*) from store.products p where p.name='${name9}' and p.main_image_key is not null and (select count(*) from store.product_images i where i.product_id=p.id)=1`)) === 1, "المنتج يحمل الصورة الرئيسية وصورة المعرض")
  ok(Number(sql("select count(*) from store.pending_uploads")) === 0, "طُولب بالمفاتيح بعد الحفظ فلا معلّق")

  ok(errors.length === 0, `لا أخطاء جافاسكربت في الصفحة${errors.length ? ": " + errors[0] : ""}`)
  await browser.close()
  console.log(failed ? `\n✗ ${failed} فشل` : "\n✓ كل الفحوص نجحت")
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
