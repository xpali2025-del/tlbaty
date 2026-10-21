import { timingSafeEqual } from 'node:crypto'

const MAX_BODY_BYTES = 4096
const MAX_TEXT_LENGTH = 500
const YEMEN_DIAL_CODE = '967'

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function tokenMatches(header, token) {
  const given = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''))
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { status: 413 })
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('bad json'), { status: 400 })
  }
}

/**
 * Builds the HTTP handler. `sendMessage(chatPhone, text)` is injected so the logic can be
 * tested without WhatsApp; `isReady()` reports whether the WhatsApp session is connected.
 * Sends are serialised with a minimum gap (+ jitter) to look less like a bot to WhatsApp.
 * Request bodies are never logged: they contain one-time codes.
 */
export function createHandler({
  token,
  sendMessage,
  isReady = () => true,
  minIntervalMs = 3000,
  jitterMs = 1500,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  random = Math.random,
}) {
  if (!token || token.length < 16) throw new Error('WHATSAPP_WORKER_TOKEN must be at least 16 characters')

  let queue = Promise.resolve()
  const enqueue = (task) => {
    const run = queue.then(task, task)
    queue = run.then(
      () => sleep(minIntervalMs + Math.floor(random() * jitterMs)),
      () => sleep(minIntervalMs),
    )
    return run
  }

  return async function handle(req, res) {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return json(res, 200, { ok: true, ready: isReady() })
      }
      if (req.method !== 'POST' || req.url !== '/send') return json(res, 404, { ok: false, error: 'NOT_FOUND' })
      if (!tokenMatches(req.headers.authorization, token)) return json(res, 401, { ok: false, error: 'UNAUTHORIZED' })
      if (!isReady()) return json(res, 503, { ok: false, error: 'NOT_READY' })

      const body = await readJson(req)
      const phone = typeof body?.phone === 'string' ? body.phone : ''
      const text = typeof body?.text === 'string' ? body.text : ''
      if (!/^\d{9}$/.test(phone)) return json(res, 400, { ok: false, error: 'INVALID_PHONE' })
      if (!text || text.length > MAX_TEXT_LENGTH) return json(res, 400, { ok: false, error: 'INVALID_TEXT' })

      try {
        await enqueue(() => sendMessage(`${YEMEN_DIAL_CODE}${phone}`, text))
      } catch (err) {
        const code = err instanceof Error && err.message === 'NOT_ON_WHATSAPP' ? 'NOT_ON_WHATSAPP' : 'SEND_FAILED'
        return json(res, code === 'NOT_ON_WHATSAPP' ? 422 : 502, { ok: false, error: code })
      }
      return json(res, 200, { ok: true })
    } catch (err) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return json(res, status, { ok: false, error: status === 500 ? 'INTERNAL' : 'BAD_REQUEST' })
    }
  }
}
