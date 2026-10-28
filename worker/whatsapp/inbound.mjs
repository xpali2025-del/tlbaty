// Click-to-chat login: the customer messages the bot number with a login token, we claim it
// at the app (which verifies the token and returns the reply text) and answer in the same chat.
// Replying to a message the customer started is far less ban-prone than messaging cold.

const TOKEN_PATTERN = /\b[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}\b/

// Must match SUPPORTED_COUNTRIES in the app's lib/phone.ts (tests/phone-agreement.test.ts checks it).
const MOBILE_RULES = {
  967: /^7\d{8}$/, // Yemen
  966: /^5\d{8}$/, // Saudi Arabia
}

/**
 * International digits (no '+') from a WhatsApp contact number, or null when the country is
 * not allowed or the number is not a valid mobile there.
 */
export function toInternationalPhone(contactNumber, allowedCountryCodes = Object.keys(MOBILE_RULES)) {
  const digits = String(contactNumber ?? '').replace(/\D/g, '')
  for (const code of allowedCountryCodes) {
    const rule = MOBILE_RULES[code]
    if (rule && digits.startsWith(code) && rule.test(digits.slice(code.length))) return digits
  }
  return null
}

/**
 * `claim({ phone, token })` (phone in international digits) calls the app and resolves to `{ ok, text?, error?, retryAfter? }`.
 * `reply(message, text)` answers inside the customer's chat. Both are injected for testing.
 * Anything that is not a plain 1:1 message with a token is ignored silently (no auto-replies to
 * strangers, groups or status updates), and each sender is throttled.
 */
export function createInboundHandler({
  claim,
  reply,
  getContactNumber,
  senderCooldownMs = 30_000,
  now = Date.now,
  allowedCountryCodes = Object.keys(MOBILE_RULES),
}) {
  const lastSeen = new Map()

  return async function onMessage(message) {
    if (message.fromMe || message.isStatus || message.from?.endsWith('@g.us') || message.from === 'status@broadcast') return
    if (typeof message.body !== 'string' || message.body.length > 200) return

    const token = TOKEN_PATTERN.exec(message.body.toUpperCase())?.[0]
    if (!token) return

    const phone = toInternationalPhone(await getContactNumber(message), allowedCountryCodes)
    if (!phone) return

    const t = now()
    const last = lastSeen.get(phone)
    if (last !== undefined && t - last < senderCooldownMs) return
    lastSeen.set(phone, t)
    if (lastSeen.size > 5000) lastSeen.clear()

    let result
    try {
      result = await claim({ phone, token })
    } catch {
      return // app unreachable: stay silent; the customer can retry
    }

    if (result?.ok && typeof result.text === 'string') return reply(message, result.text)
    if (result?.error === 'RESEND_TOO_SOON' && Number.isFinite(result.retryAfter)) {
      return reply(message, `أرسلنا لك رمزاً قبل قليل. يمكنك طلب رمز جديد بعد ${result.retryAfter} ثانية.`)
    }
    // Unknown/used token, rate limit, errors: no reply (avoids loops and probing).
  }
}

/**
 * ينشئ دالة claim التي تستدعي الموقع: المصادقة بتوكن العامل (WHATSAPP_WORKER_TOKEN)،
 * ورمز الدخول الذي أرسله العميل في جسم الطلب فقط. الاسمان منفصلان عمداً كي لا يحجب أحدهما الآخر.
 */
export function createAppClaim({ url, workerToken, fetchImpl = fetch, timeoutMs = 10_000 }) {
  return async ({ phone, token: loginToken }) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({ phone, token: loginToken }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.json().catch(() => ({ ok: false }))
  }
}
