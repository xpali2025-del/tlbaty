// اختبار دخان بعد `pnpm build`: يشغّل الخادم ويتحقق أن الصفحات الأساسية تُخدم بلا أخطاء.
// بلا متصفح ولا قاعدة بيانات (الصفحات تعمل بقيم احتياطية)، فيكتشف كسر البناء أو التوجيه أو الصفحات الأساسية فقط.
// الاستخدام: pnpm build && pnpm smoke
import { spawn } from "node:child_process"
import { join } from "node:path"

const PORT = process.env.SMOKE_PORT || "3199"
const BASE = `http://127.0.0.1:${PORT}`

// [المسار، الحالة المتوقعة]. /manage بلا جلسة يوجّه لصفحة الدخول (لا يُعرض شيء من اللوحة).
const CHECKS = [
  ["/", 200],
  ["/shop", 200],
  ["/categories", 200],
  ["/search", 200],
  ["/cart", 200],
  ["/login", 200],
  ["/about", 200],
  ["/contact", 200],
  ["/faq", 200],
  ["/manage/login", 200],
  ["/manage", 307],
  ["/api/health", 200],
  ["/no-such-page-xyz", 404],
]

const server = spawn(join(process.cwd(), "node_modules", ".bin", "next"), ["start", "-p", PORT], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "production" } })
let log = ""
server.stdout.on("data", (d) => (log += d))
server.stderr.on("data", (d) => (log += d))
const stop = () => server.kill("SIGTERM")
process.on("exit", stop)

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (res.status < 500) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function main() {
  if (!(await waitReady())) {
    console.error("✗ الخادم لم يبدأ خلال 30 ثانية\n" + log.slice(-1500))
    process.exit(1)
  }
  const failures = []
  for (const [path, expected] of CHECKS) {
    try {
      const res = await fetch(BASE + path, { redirect: "manual" })
      const html = path.startsWith("/api/") ? "" : await res.text()
      const okHtml = !html || expected !== 200 || (html.includes("<html") && html.includes('dir="rtl"'))
      const ok = res.status === expected && okHtml
      console.log(`${ok ? "✓" : "✗"} ${String(res.status).padEnd(4)} ${path}`)
      if (!ok) failures.push(`${path}: ${res.status} (المتوقع ${expected})${okHtml ? "" : " — الصفحة بلا html/rtl"}`)
    } catch (error) {
      console.log(`✗ ERR  ${path}`)
      failures.push(`${path}: ${error instanceof Error ? error.message : error}`)
    }
  }
  stop()
  if (failures.length > 0) {
    console.error(`\n✗ فشل ${failures.length} فحص:\n  ` + failures.join("\n  ") + "\n\nسجل الخادم:\n" + log.slice(-1500))
    process.exit(1)
  }
  console.log("\n✓ اختبار الدخان سليم")
}

main().then(() => process.exit(process.exitCode ?? 0))
