// وسيط TCP بين التطبيق وPostgres: يضيف تأخيراً ثابتاً لكل اتجاه ويعدّ الاستعلامات (رسائل Parse/Query).
// يحاكي قاعدة بعيدة عن خادم Vercel. الاستخدام: DELAY_MS=50 node scripts/bench/latency-proxy.mjs
// المنافذ: 5433 للتطبيق (يمرّر إلى 5432)، و5434 للعدّاد: GET / عدد الاستعلامات، GET /reset تصفير.
import http from "node:http"
import net from "node:net"

const DELAY = Number(process.env.DELAY_MS ?? 50)
const TARGET_PORT = Number(process.env.PG_PORT ?? 5432)
let queries = 0

net
  .createServer((client) => {
    const server = net.connect(TARGET_PORT, "127.0.0.1")
    let buf = Buffer.alloc(0)
    let started = false
    client.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk])
      for (;;) {
        if (!started) {
          if (buf.length < 8) break
          const len = buf.readInt32BE(0)
          if (buf.length < len) break
          const code = buf.readInt32BE(4)
          buf = buf.subarray(len)
          // طلب SSL لا يبدأ الجلسة بعد
          if (!(len === 8 && (code === 80877103 || code === 80877104))) started = true
          continue
        }
        if (buf.length < 5) break
        const len = buf.readInt32BE(1)
        if (buf.length < len + 1) break
        const type = String.fromCharCode(buf[0])
        if (type === "P" || type === "Q") queries++
        buf = buf.subarray(len + 1)
      }
      setTimeout(() => server.write(chunk), DELAY)
    })
    server.on("data", (chunk) => setTimeout(() => client.write(chunk), DELAY))
    const end = () => {
      client.destroy()
      server.destroy()
    }
    client.on("error", end)
    server.on("error", end)
    client.on("close", end)
    server.on("close", end)
  })
  .listen(5433, "127.0.0.1")

http
  .createServer((req, res) => {
    if (req.url === "/reset") queries = 0
    res.end(String(queries))
  })
  .listen(5434, "127.0.0.1")

console.log(`latency proxy up: ${DELAY}ms per direction`)
