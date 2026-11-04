// تحقق في المتصفح من الرفع عند اختيار الصورة (المرحلة 2 من docs/admin-instant-save-plan.md) على خادم إنتاج حقيقي.
// ليس ضمن CI. التشغيل: انظر scripts/bench/README.md للبناء (متغيرات R2 الوهمية) والتشغيل، ثم:
//   set -a; . /tmp/e2e.env; set +a; FIXTURES=/tmp/fixtures node scripts/e2e/preupload.e2e.mjs
// R2 وهمي: يعترض الـ PUT ويردّ 200 ويعدّه. يحتاج DATABASE_URL (لقراءة الحقيقة من القاعدة) وصور الاختبار (make-fixtures).
// الفيديو: متصفح Chromium المرفق لا يفك H.264، فيُختبر بـ MP4 بترميز VP9 (يفكه). الملف يُولَّد بـ ffmpeg:
//   ffmpeg -f lavfi -i testsrc=size=1200x600:rate=10 -t 3 -c:v libvpx-vp9 -b:v 300k -an $FIXTURES/ad-test.mp4
import { execFileSync } from "node:child_process"
import path from "node:path"
import { createRequire } from "node:module"

const { chromium } = createRequire(import.meta.url)("playwright")
const BASE = process.env.BASE || "http://127.0.0.1:3311"
const FIXTURES = process.env.FIXTURES || "/tmp/claude-0/perf/fixtures"
const VIEWPORT = { width: Number(process.env.WIDTH || 1280), height: 900 }
const photo = (n) => path.join(FIXTURES, `photo-${n}.jpg`)
const sql = (q) => execFileSync("psql", [process.env.DATABASE_URL, "-tAc", q], { encoding: "utf8" }).trim()
const pendingCount = () => Number(sql("select count(*) from store.pending_uploads"))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const ok = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`)
  if (!cond) failed++
}
async function until(fn, ms = 10000, step = 100) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return true
    await sleep(step)
  }
  return false
}

const CORS = { "access-control-allow-origin": "*", "access-control-expose-headers": "etag" }
const r2 = { puts: 0, delayMs: 0, failNext: 0 }

async function login(context) {
  const page = await context.newPage()
  await page.route(
    (url) => url.host.endsWith("r2.cloudflarestorage.com"),
    async (route) => {
      if (route.request().method() !== "PUT") return route.fulfill({ status: 204, headers: CORS })
      r2.puts++
      if (r2.delayMs) await sleep(r2.delayMs)
      if (r2.failNext > 0) {
        r2.failNext--
        return route.abort("failed")
      }
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

const openFirstEdit = async (page, nav) => {
  await page.click(`nav >> text=${nav}`)
  await page.locator("button:has(span.sr-only:text('تعديل'))").first().click()
  await page.waitForSelector("[role=dialog]")
}
const allDone = (page, count) =>
  page.waitForFunction(
    (n) => {
      const els = [...document.querySelectorAll("[role=dialog] [data-upload-state]")]
      return els.length >= n && els.every((e) => e.getAttribute("data-upload-state") === "done")
    },
    count,
    { timeout: 30000 },
  )
const save = (page) => page.getByRole("button", { name: "حفظ التغييرات" }).click()

;(async () => {
  sql("delete from store.pending_uploads")
  const browser = await chromium.launch()
  const page = await login(await browser.newContext({ viewport: VIEWPORT }))
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))

  // ---------- 1) الرفع يبدأ عند الاختيار، والحفظ لا يعيده ----------
  await openFirstEdit(page, "الأقسام")
  await page.locator("[role=dialog] input[type=file][name=image]").setInputFiles(photo(1))
  await allDone(page, 1)
  ok(r2.puts === 1, "الصورة رُفعت إلى R2 بمجرد اختيارها، قبل أي ضغط على «حفظ»")
  ok(pendingCount() === 1, "سُجّل المفتاح معلّقاً في الخادم")
  const key1 = sql("select object_key from store.pending_uploads")
  const putsBeforeSave = r2.puts
  const t0 = Date.now()
  await save(page)
  await page.waitForSelector("[role=dialog]", { state: "hidden", timeout: 30000 })
  const saveMs = Date.now() - t0
  ok(r2.puts === putsBeforeSave, `الحفظ لم يرفع الصورة ثانية (طلبات PUT: ${r2.puts})`)
  ok(Number(sql(`select count(*) from store.categories where image_key = '${key1}'`)) === 1, "القسم يحمل مفتاح الصورة المرفوعة مسبقاً")
  ok(pendingCount() === 0, "طالب الحفظ الناجح بالمفتاح فأُزيل من المعلّقة")
  console.log(`  (زمن الحفظ بعد الاختيار المسبق: ${saveMs} ms)`)

  // ---------- 2) الحفظ ينتظر رفعاً لم يكتمل ----------
  r2.delayMs = 2500
  const before2 = r2.puts
  await openFirstEdit(page, "الأقسام")
  await page.locator("[role=dialog] input[type=file][name=image]").setInputFiles(photo(2))
  await sleep(300) // الرفع بدأ لكنه لم يكتمل (مؤخَّر 2.5 ثانية)
  const t1 = Date.now()
  await save(page)
  await page.waitForSelector("[role=dialog]", { state: "hidden", timeout: 30000 })
  const waited = Date.now() - t1
  r2.delayMs = 0
  ok(waited >= 1500, `الحفظ انتظر الرفع الجاري (${waited} ms)`)
  ok(r2.puts === before2 + 1, "صورة واحدة رُفعت (لا رفع مكرر عند الحفظ)")
  ok(pendingCount() === 0, "المطالبة تمت بعد الانتظار")

  // ---------- 3) استبدال الصورة يحذف السابقة ----------
  await openFirstEdit(page, "الأقسام")
  await page.locator("[role=dialog] input[type=file][name=image]").setInputFiles(photo(1))
  await allDone(page, 1)
  const first = sql("select object_key from store.pending_uploads")
  await page.locator("[role=dialog] input[type=file][name=image]").setInputFiles(photo(2))
  await sleep(500)
  await allDone(page, 1)
  ok(await until(() => pendingCount() === 1 && sql("select object_key from store.pending_uploads") !== first), "استبدال الصورة ألغى المرفوعة السابقة (بقيت الجديدة فقط)")

  // ---------- 4) إلغاء النموذج يحذف المرفوعات ----------
  await page.getByRole("button", { name: "إلغاء" }).click()
  await page.waitForSelector("[role=dialog]", { state: "hidden" })
  ok(await until(() => pendingCount() === 0), "إلغاء النموذج حذف المرفوعات غير المحفوظة")

  // ---------- 5) منتج جديد: 3 صور، ثم إلغاء ----------
  await page.click("nav >> text=المنتجات")
  await page.click("button:has-text('منتج جديد')")
  await page.waitForSelector("[role=dialog]")
  await page.locator("[role=dialog] input[type=file][name=image]").setInputFiles(photo(1))
  await page.locator("[role=dialog] input[type=file][name=newImages]").setInputFiles([photo(2), photo(3)])
  await allDone(page, 2)
  ok(pendingCount() === 3, "الصور الثلاث رُفعت وسُجّلت (رئيسية + معرض)")
  await page.getByRole("button", { name: "إلغاء" }).click()
  await page.waitForSelector("[role=dialog]", { state: "hidden" })
  ok(await until(() => pendingCount() === 0), "إلغاء نموذج المنتج حذف الصور الثلاث")

  // ---------- 6) فشل الرفع المسبق: يظهر للمدير ويُعاد عند الحفظ ----------
  r2.failNext = 5 // المحاولات الخمس كلها (putImage يعيد المحاولة)
  const before6 = r2.puts
  await openFirstEdit(page, "الأقسام")
  await page.locator("[role=dialog] input[type=file][name=image]").setInputFiles(photo(1))
  const errorShown = await page
    .waitForSelector('[role=dialog] [data-upload-state="error"]', { timeout: 40000 })
    .then(() => true)
    .catch(() => false)
  ok(errorShown, "فشل الرفع المسبق ظهر على الحقل")
  ok(await page.getByText("سيُعاد عند «حفظ»").first().isVisible().catch(() => false), "نص الخطأ يقول إن الرفع سيُعاد عند «حفظ»")
  await save(page)
  await page.waitForSelector("[role=dialog]", { state: "hidden", timeout: 40000 })
  ok(r2.puts === before6 + 6, `الحفظ أعاد الرفع فنجح (PUT: ${r2.puts - before6})`)
  ok(pendingCount() === 0, "بعد الحفظ لا مفاتيح معلّقة")

  // ---------- 7) الإعدادات: الحقل يبقى معروضاً، فالحفظ الثاني لا يعيد الرفع ----------
  await page.click("nav >> text=إعدادات الموقع")
  await page.waitForSelector("input[name=name]")
  await page.locator("input[type=file][name=logo]").setInputFiles(photo(1))
  await page.waitForFunction(() => document.querySelector("[data-upload-state]")?.getAttribute("data-upload-state") === "done", null, { timeout: 30000 })
  const before7 = r2.puts
  await save(page)
  await page.getByRole("button", { name: "جارٍ الحفظ…" }).waitFor({ state: "hidden", timeout: 30000 }).catch(() => {})
  await sleep(500)
  const logo1 = sql("select logo_key from store.site_settings")
  ok(!!logo1, "الشعار حُفظ")
  ok(r2.puts === before7, "حفظ الشعار لم يرفعه ثانية")
  await save(page)
  await sleep(2500)
  ok(r2.puts === before7 && sql("select logo_key from store.site_settings") === logo1, "حفظ ثانٍ بالحقل نفسه لم يرفع شيئاً ولم يغيّر المفتاح")

  // ---------- 8) فيديو الإعلان: الفيديو وغلافه يُرفعان عند الاختيار ----------
  const video = path.join(FIXTURES, "ad-test.mp4")
  const openNewAd = async () => {
    await page.click("nav >> text=الإعلانات")
    await page.click("button:has-text('إعلان جديد')")
    await page.waitForSelector("[role=dialog]")
    await page.locator("[role=dialog] [role=radio]:has-text('فيديو')").click()
  }
  await openNewAd()
  const before8 = r2.puts
  await page.locator("[role=dialog] input[type=file][accept='video/mp4']").setInputFiles(video)
  ok(await page.getByText("رُفع الفيديو").first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false), "الفيديو رُفع بمجرد اختياره")
  ok(await until(() => r2.puts === before8 + 2 && pendingCount() === 2, 15000), `الفيديو وصورة غلافه المستخرجة رُفعا قبل «حفظ» (PUT: ${r2.puts - before8}، معلّقة: ${pendingCount()})`)
  await page.locator("[role=dialog] input[name=title]").fill("إعلان فيديو e2e")
  const putsBeforeAdSave = r2.puts
  await save(page)
  await page.waitForSelector("[role=dialog]", { state: "hidden", timeout: 30000 })
  ok(r2.puts === putsBeforeAdSave, "حفظ الإعلان لم يرفع الفيديو ولا الغلاف ثانية")
  const adRow = sql("select video_key || '|' || image_key from store.ads where title = 'إعلان فيديو e2e'")
  ok(adRow.includes("ads/") && adRow.includes(".mp4|ads/"), `الإعلان حُفظ بمفتاحي الفيديو والغلاف (${adRow ? "موجودان" : "ناقصان"})`)
  ok(pendingCount() === 0, "طالب الحفظ بالمفتاحين فأُزيلا من المعلّقة")

  // إلغاء نموذج فيه فيديو مرفوع
  await openNewAd()
  await page.locator("[role=dialog] input[type=file][accept='video/mp4']").setInputFiles(video)
  ok(await until(() => pendingCount() === 2, 30000), "فيديو وغلاف جديدان معلّقان")
  await page.getByRole("button", { name: "إلغاء" }).click()
  await page.waitForSelector("[role=dialog]", { state: "hidden" })
  ok(await until(() => pendingCount() === 0), "إلغاء نموذج الإعلان حذف الفيديو والغلاف المرفوعين")

  // ملف غير صالح كفيديو: الخطأ يظهر عند الاختيار لا عند «حفظ»
  await openNewAd()
  await page.locator("[role=dialog] input[type=file][accept='video/mp4']").setInputFiles(photo(1))
  ok(await page.getByText(/تعذّر قراءة الفيديو|نوع الفيديو غير مدعوم/).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false), "ملف غير فيديو رُفض عند اختياره برسالة واضحة")
  await page.getByRole("button", { name: "إلغاء" }).click()
  await page.waitForSelector("[role=dialog]", { state: "hidden" })
  sql("delete from store.ads where title = 'إعلان فيديو e2e'")

  ok(errors.length === 0, `لا أخطاء في الصفحة ${errors.join(";")}`)
  await browser.close()
  console.log(failed ? `\n${failed} فحص فشل` : "\nكل الفحوص نجحت")
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
