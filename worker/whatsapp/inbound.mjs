// Click-to-chat login: the customer messages the bot number with a login token, we claim it
// at the app (which verifies the token and returns the reply text) and answer in the same chat.
// Replying to a message the customer started is far less ban-prone than messaging cold.

const TOKEN_PATTERN = /\b[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}\b/
const YEMEN_NUMBER = /^967(\d{9})$/

/** Local 9-digit Yemeni number from a WhatsApp contact number, or null (other countries unsupported). */
export function toLocalPhone(contactNumber) {
  const m = YEMEN_NUMBER.exec(String(contactNumber ?? '').replace(/\D/g, ''))
  return m ? m[1] : null
}

/**
 * `claim({ phone, token })` calls the app and resolves to `{ ok, text?, error?, retryAfter? }`.
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
}) {
  const lastSeen = new Map()

  return async function onMessage(message) {
    if (message.fromMe || message.isStatus || message.from?.endsWith('@g.us') || message.from === 'status@broadcast') return
    if (typeof message.body !== 'string' || message.body.length > 200) return

    const token = TOKEN_PATTERN.exec(message.body.toUpperCase())?.[0]
    if (!token) return

    const phone = toLocalPhone(await getContactNumber(message))
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
