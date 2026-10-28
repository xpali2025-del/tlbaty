import path from "node:path"
import { timingSafeEqual } from "node:crypto"
import { revalidatePath, revalidateTag } from "next/cache"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import journal from "@/drizzle/meta/_journal.json"
import { CACHE_TAGS } from "@/lib/cache-tags"
import { classifyDbError, DB_ERROR_HINTS } from "@/lib/db-error"
import { currencies, products, siteSettings } from "@/lib/db/store"
import { checkEnv, pendingMigrations, suggestRegion, type EnvCheck } from "@/lib/diagnose"
import { hitRateLimit } from "@/lib/rate-limit-memory"

// GET/POST /api/diagnose — صفحة فحص إعداد الموقع للمالك: المتغيرات الناقصة، والاتصال بالقاعدة، والترحيلات،
// وتطبيق الترحيلات الناقصة بزر. مسار API لا يمر بالتخطيط الجذري، فيعمل حتى لو كانت كل صفحات الموقع معطلة.
// محمية بكلمة مرور اللوحة (MANAGE_PASSWORD) في نموذج POST (لا في الرابط فلا تُسجَّل)، ولا تُظهر أي قيمة سرية.

export const dynamic = "force-dynamic"
export const maxDuration = 60

const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }

const esc = (value: unknown) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

function page(body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>فحص إعداد الموقع</title>
<style>
body{font-family:system-ui,Tahoma,sans-serif;max-width:860px;margin:0 auto;padding:16px;color:#111;background:#fafafa;line-height:1.6}
h1{font-size:20px}h2{font-size:16px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px}
table{width:100%;border-collapse:collapse;background:#fff;font-size:14px}td,th{border:1px solid #e5e5e5;padding:6px 8px;text-align:right;vertical-align:top}
code{direction:ltr;unicode-bidi:embed;background:#f0f0f0;padding:1px 4px;border-radius:4px}
.ok{color:#15803d}.bad{color:#b91c1c;font-weight:700}.warn{color:#a16207}.muted{color:#666}
.box{background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:12px;margin:12px 0}
input,button{font:inherit;padding:8px 12px;border-radius:6px;border:1px solid #ccc}button{background:#111;color:#fff;border:0;cursor:pointer}
</style></head><body>${body}</body></html>`,
    { status, headers: HEADERS },
  )
}

const passwordForm = (message = "") => `
<h1>فحص إعداد الموقع</h1>
<p class="muted">يعرض المتغيرات الناقصة أو الخاطئة وحالة قاعدة البيانات، دون إظهار أي قيمة سرية.</p>
${message ? `<p class="bad">${esc(message)}</p>` : ""}
<form method="post" class="box">
  <label>كلمة مرور لوحة الإدارة (MANAGE_PASSWORD)<br><input type="password" name="password" autocomplete="current-password" required></label>
  <button type="submit" name="action" value="check">افحص</button>
</form>`

export async function GET() {
  return page(passwordForm())
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

type DbReport = {
  connected: boolean
  latencyMs: number | null
  error: string | null
  hint: string | null
  storeSchema: boolean
  pending: string[]
  applied: number
  queries: { name: string; ok: boolean; error?: string }[]
  products: number | null
}

const errorText = (error: unknown) => {
  const parts: string[] = []
  let current: unknown = error
  for (let i = 0; i < 4 && current && typeof current === "object"; i++) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown }
    const line = [typeof e.code === "string" ? e.code : "", typeof e.message === "string" ? e.message : ""].join(" ").trim()
    if (line && !parts.includes(line)) parts.push(line)
    current = e.cause
  }
  // لا نعرض نص الاستعلام الذي يرفقه drizzle (طويل وبلا فائدة للمالك)
  return parts.map((p) => p.replace(/^Failed query: [\s\S]*?params:.*$/m, "").trim()).filter(Boolean).join(" ← ").slice(0, 400)
}

async function inspectDb(url: string): Promise<DbReport> {
  const client = postgres(url, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 })
  const report: DbReport = { connected: false, latencyMs: null, error: null, hint: null, storeSchema: false, pending: [], applied: 0, queries: [], products: null }
  try {
    const timings: number[] = []
    for (let i = 0; i < 3; i++) {
      const started = Date.now()
      await client`select 1`
      timings.push(Date.now() - started)
    }
    report.connected = true
    report.latencyMs = timings.sort((a, b) => a - b)[1]

    const [{ exists }] = await client`select exists(select 1 from information_schema.schemata where schema_name = 'store') as exists`
    report.storeSchema = Boolean(exists)
    const [{ table }] = await client`select to_regclass('drizzle.__drizzle_migrations')::text as table`
    const appliedRows = table ? await client`select created_at from drizzle.__drizzle_migrations order by created_at` : []
    report.applied = appliedRows.length
    const last = appliedRows.length ? Number(appliedRows[appliedRows.length - 1].created_at) : null
    report.pending = pendingMigrations(journal.entries, last)

    // نفس القراءات التي يحتاجها كل صفحة (التخطيط الجذري): إن فشلت هنا فهي سبب تعطل الموقع.
    const db = drizzle(client)
    const probes: [string, () => Promise<unknown>][] = [
      ["إعدادات المتجر (site_settings)", () => db.select().from(siteSettings).limit(1)],
      ["العملات (currencies)", () => db.select().from(currencies).limit(1)],
      ["المنتجات (products)", async () => (report.products = (await client`select count(*)::int as n from store.products`)[0].n as number)],
      ["أعمدة المنتجات", () => db.select().from(products).limit(1)],
    ]
    for (const [name, run] of probes) {
      try {
        await run()
        report.queries.push({ name, ok: true })
      } catch (error) {
        report.queries.push({ name, ok: false, error: errorText(error) })
        report.hint ??= DB_ERROR_HINTS[classifyDbError(error)]
      }
    }
  } catch (error) {
    report.error = errorText(error)
    report.hint = DB_ERROR_HINTS[classifyDbError(error)]
  } finally {
    await client.end({ timeout: 2 }).catch(() => {})
  }
  return report
}

async function applyMigrations(url: string): Promise<string | null> {
  const client = postgres(url, { prepare: false, max: 1, connect_timeout: 10, onnotice: () => {} })
  try {
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") })
    for (const tag of Object.values(CACHE_TAGS)) revalidateTag(tag, { expire: 0 })
    revalidatePath("/", "layout")
    return null
  } catch (error) {
    return errorText(error) || "فشل تطبيق الترحيلات"
  } finally {
    await client.end({ timeout: 2 }).catch(() => {})
  }
}

const STATUS_LABEL: Record<EnvCheck["status"], string> = {
  ok: '<span class="ok">✓ سليم</span>',
  missing: '<span class="bad">✗ ناقص (مطلوب)</span>',
  invalid: '<span class="bad">✗ قيمته خطأ</span>',
  optional: '<span class="muted">— غير مضبوط (اختياري)</span>',
}

function envTable(checks: EnvCheck[]) {
  const groups = [...new Set(checks.map((c) => c.group))]
  return groups
    .map(
      (group) => `<h2>${esc(group)}</h2><table><tr><th>المتغير</th><th>الحالة</th><th>ملاحظة</th></tr>${checks
        .filter((c) => c.group === group)
        .map((c) => `<tr><td><code>${esc(c.name)}</code></td><td>${STATUS_LABEL[c.status]}</td><td>${esc(c.note)}</td></tr>`)
        .join("")}</table>`,
    )
    .join("")
}

function dbSection(db: DbReport | null, region: ReturnType<typeof suggestRegion>) {
  if (!db) return `<h2>قاعدة البيانات</h2><p class="bad">لم تُفحص: صحّح DATABASE_URL أولاً.</p>`
  if (!db.connected) {
    return `<h2>قاعدة البيانات</h2><p class="bad">✗ تعذّر الاتصال</p><p>${esc(db.hint ?? "")}</p><p class="muted"><code>${esc(db.error ?? "")}</code></p>`
  }
  const vercelRegion = process.env.VERCEL_REGION
  const regionLine = region
    ? `<p>منطقة القاعدة: <code>${esc(region.dbRegion)}</code> · منطقة دوال Vercel الآن: <code>${esc(vercelRegion ?? "غير معروفة")}</code>${
        region.vercelRegion && vercelRegion && vercelRegion !== region.vercelRegion
          ? ` — <span class="warn">للسرعة اختر <code>${esc(region.vercelRegion)}</code> من Vercel ← Settings ← Functions ← Function Region</span>`
          : region.vercelRegion && vercelRegion === region.vercelRegion
            ? ' <span class="ok">✓ متطابقتان</span>'
            : ""
      }</p>`
    : ""
  const latencyClass = (db.latencyMs ?? 0) > 60 ? "warn" : "ok"
  return `<h2>قاعدة البيانات</h2>
<p class="ok">✓ الاتصال يعمل</p>
<p>زمن الذهاب والإياب: <span class="${latencyClass}">${db.latencyMs} ملّي ثانية</span>${(db.latencyMs ?? 0) > 60 ? " — مرتفع: كل حفظ وتصفح ينتظره عدة مرات" : ""}</p>
${regionLine}
<p>مخطط <code>store</code>: ${db.storeSchema ? '<span class="ok">✓ موجود</span>' : '<span class="bad">✗ غير موجود</span>'} · ترحيلات مطبّقة: ${db.applied} من ${journal.entries.length}</p>
${
  db.pending.length
    ? `<div class="box"><p class="bad">✗ ترحيلات لم تُطبَّق (${db.pending.length}): ${db.pending.map((t) => `<code>${esc(t)}</code>`).join(" ")}</p>
<p>هذا يعطّل الصفحات التي تقرأ الأعمدة الجديدة. اضغط لتطبيقها الآن على قاعدة الإنتاج (آمن: يطبّق الناقص فقط، داخل معاملة).</p>
<form method="post"><input type="hidden" name="password" value="__PW__"><button type="submit" name="action" value="migrate">طبّق الترحيلات الناقصة</button></form></div>`
    : '<p class="ok">✓ كل الترحيلات مطبّقة</p>'
}
<table><tr><th>قراءة يحتاجها الموقع</th><th>النتيجة</th></tr>${db.queries
    .map((q) => `<tr><td>${esc(q.name)}</td><td>${q.ok ? '<span class="ok">✓ تعمل</span>' : `<span class="bad">✗ تفشل</span><br><code>${esc(q.error ?? "")}</code>`}</td></tr>`)
    .join("")}</table>
${db.products !== null ? `<p class="muted">عدد المنتجات: ${db.products}</p>` : ""}
${db.hint && !db.pending.length && db.queries.some((q) => !q.ok) ? `<p class="warn">${esc(db.hint)}</p>` : ""}`
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  if (hitRateLimit(`diagnose:${ip}`, 10, 15 * 60_000)) return page(passwordForm("محاولات كثيرة. انتظر 15 دقيقة."), 429)

  const form = await request.formData().catch(() => null)
  const password = String(form?.get("password") ?? "")
  const action = String(form?.get("action") ?? "check")
  const expected = process.env.MANAGE_PASSWORD?.trim()
  const checks = checkEnv(process.env)

  if (!expected) {
    // بلا كلمة مرور لا يمكن التحقق من هوية الزائر: نعرض أسماء المتغيرات وحالتها فقط (لا قاعدة ولا أخطاء).
    return page(`<h1>فحص إعداد الموقع</h1><p class="bad">MANAGE_PASSWORD غير مضبوط: أضفه في Vercel ثم Redeploy لتفتح تفاصيل الفحص.</p>${envTable(checks)}`)
  }
  if (!safeEqual(password, expected)) return page(passwordForm("كلمة المرور غير صحيحة"), 401)

  const dbCheck = checks.find((c) => c.name === "DATABASE_URL")!
  const dbUrl = process.env.DATABASE_URL_2?.trim() || process.env.DATABASE_URL?.trim()
  let migrateResult = ""
  if (action === "migrate" && dbUrl && dbCheck.status === "ok") {
    const failure = await applyMigrations(dbUrl)
    migrateResult = failure
      ? `<div class="box"><p class="bad">✗ فشل تطبيق الترحيلات</p><code>${esc(failure)}</code></div>`
      : '<div class="box"><p class="ok">✓ طُبّقت الترحيلات. افتح الموقع الآن.</p></div>'
  }
  const db = dbUrl && dbCheck.status === "ok" ? await inspectDb(dbUrl) : null
  const problems = checks.filter((c) => c.status === "missing" || c.status === "invalid").length + (db && (!db.connected || db.pending.length || db.queries.some((q) => !q.ok)) ? 1 : 0)

  return page(
    `<h1>فحص إعداد الموقع</h1>
${migrateResult}
<div class="box">${problems ? `<p class="bad">وُجدت ${problems} مشكلة. صحّح المعلَّم بالأحمر في Vercel ← Settings ← Environment Variables ثم Deployments ← Redeploy.</p>` : '<p class="ok">✓ لا مشكلات في الإعداد.</p>'}</div>
${dbSection(db, suggestRegion(dbUrl)).replace("__PW__", esc(password))}
${envTable(checks)}
<form method="post" style="margin-top:20px"><input type="hidden" name="password" value="${esc(password)}"><button type="submit" name="action" value="check">أعد الفحص</button></form>`,
  )
}
