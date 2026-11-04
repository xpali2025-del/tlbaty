// قياس مكتبة الاتصال بقاعدة البيانات (المرحلة 6 من docs/admin-instant-save-plan.md): postgres.js (الحالي، prepare:false)
// مقابل node-postgres (pg) عبر وسيط تأخير يحاكي بُعد الخادم عن القاعدة. نفس الاستعلامات ونفس الوسيط لكل مكتبة.
// ليس ضمن CI. التشغيل: node scripts/bench/latency-proxy.mjs & (DELAY_MS=50 = 100ms ذهاباً وإياباً)، ثم
//   DATABASE_URL=postgresql://USER:PASS@127.0.0.1:5433/DB?sslmode=disable node scripts/bench/db-driver.mjs
import postgres from "postgres"
import pg from "pg"

const url = process.env.DATABASE_URL
const ROUNDS = Number(process.env.ROUNDS || 15)
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]

async function timed(fn) {
  const t = performance.now()
  await fn()
  return performance.now() - t
}

const drivers = {
  "postgres.js (prepare:false)": async () => {
    const sql = postgres(url, { prepare: false, max: 5 })
    return {
      query: (text, params) => sql.unsafe(text, params),
      tx: (fn) => sql.begin((t) => fn((text, params) => t.unsafe(text, params))),
      close: () => sql.end(),
    }
  },
  "postgres.js (fetch_types:false)": async () => {
    const sql = postgres(url, { prepare: false, max: 5, fetch_types: false })
    return {
      query: (text, params) => sql.unsafe(text, params),
      tx: (fn) => sql.begin((t) => fn((text, params) => t.unsafe(text, params))),
      close: () => sql.end(),
    }
  },
  "node-postgres (pg)": async () => {
    const pool = new pg.Pool({ connectionString: url, max: 5 })
    return {
      query: (text, params) => pool.query(text, params),
      tx: async (fn) => {
        const c = await pool.connect()
        try {
          await c.query("begin")
          const r = await fn((text, params) => c.query(text, params))
          await c.query("commit")
          return r
        } catch (e) {
          await c.query("rollback").catch(() => {})
          throw e
        } finally {
          c.release()
        }
      },
      close: () => pool.end(),
    }
  },
}

const WORK = {
  "استعلام واحد بمعاملات": (d) => d.query("select id, name from store.categories where slug = $1 limit 1", ["no-such-slug"]),
  "5 استعلامات متتابعة بمعاملات": async (d) => {
    for (let i = 0; i < 5; i++) await d.query("select count(*)::int from store.products where price >= $1", [i])
  },
  "معاملة من 4 جمل (كحفظ منتج)": (d) =>
    d.tx(async (q) => {
      await q("select 1 where $1::int = 1", [1])
      await q("select id from store.categories where slug = $1", ["x"])
      await q("select id from store.brands where slug = $1", ["x"])
      await q("select count(*)::int from store.products where category_id is null and price > $1", [0])
    }),
}

for (const [name, make] of Object.entries(drivers)) {
  const d = await make()
  await d.query("select 1") // اتصال أولي لا يُحسب (يُقاس تكلفته أدناه)
  const rows = []
  for (const [label, work] of Object.entries(WORK)) {
    await work(d)
    const times = []
    for (let i = 0; i < ROUNDS; i++) times.push(await timed(() => work(d)))
    rows.push(`| ${label} | ${median(times).toFixed(0)} | ${p95(times).toFixed(0)} |`)
  }
  await d.close()
  const cold = await make()
  const coldMs = await timed(() => cold.query("select 1"))
  await cold.close()
  console.log(`\n### ${name}\n| العمل | وسيط ms | p95 ms |\n|---|---|---|\n${rows.join("\n")}\n(أول استعلام على اتصال جديد: ${coldMs.toFixed(0)} ms)`)
}
