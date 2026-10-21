// WhatsApp OTP sender (whatsapp-web.js). Runs as a long-lived process on its own host —
// NOT on Vercel/serverless. See README.md for setup, risks and hardening.
import http from 'node:http'
import qrcode from 'qrcode-terminal'
import pkg from 'whatsapp-web.js'
import { createHandler } from './handler.mjs'
import { createInboundHandler } from './inbound.mjs'

const { Client, LocalAuth } = pkg

const token = process.env.WHATSAPP_WORKER_TOKEN ?? ''
const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 3100)
const dataPath = process.env.WWEBJS_DATA_PATH ?? './.wwebjs_auth'

let ready = false

const client = new Client({
  authStrategy: new LocalAuth({ dataPath }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
})

client.on('qr', (qr) => {
  console.log('Scan this QR with the dedicated WhatsApp number (Linked devices):')
  qrcode.generate(qr, { small: true })
})
client.on('ready', () => {
  ready = true
  console.log('WhatsApp session ready')
})
client.on('disconnected', (reason) => {
  ready = false
  console.error('WhatsApp disconnected:', reason, '- exiting so the supervisor restarts the process')
  process.exit(1)
})
client.on('auth_failure', () => {
  ready = false
  console.error('WhatsApp auth failure - delete the session folder and scan the QR again')
})

const intEnv = (name, fallback) => {
  const n = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

async function sendMessage(phone, text) {
  const id = await client.getNumberId(phone)
  if (!id) throw new Error('NOT_ON_WHATSAPP')
  // Show "typing..." for a human-like moment (proportional to the text) before sending.
  try {
    const chat = await client.getChatById(id._serialized)
    await chat.sendStateTyping()
    await new Promise((r) => setTimeout(r, 1000 + text.length * 25 + Math.random() * 1500))
  } catch {
    // Typing indication is cosmetic; never block the code on it.
  }
  await client.sendMessage(id._serialized, text)
}

const handler = createHandler({
  token,
  sendMessage,
  isReady: () => ready,
  recipientCooldownMs: intEnv('WORKER_RECIPIENT_COOLDOWN_MS', 60_000),
  maxPerHour: intEnv('WORKER_MAX_PER_HOUR', 60),
  maxPerDay: intEnv('WORKER_MAX_PER_DAY', 300),
})
http.createServer(handler).listen(port, host, () => console.log(`worker listening on ${host}:${port}`))

// Click-to-chat login (optional): needs APP_CLAIM_URL, e.g. https://shop.example.com/api/auth/chat-login/claim
const claimUrl = process.env.APP_CLAIM_URL
if (claimUrl) {
  const onMessage = createInboundHandler({
    getContactNumber: async (message) => (await message.getContact()).number,
    claim: async ({ phone, token }) => {
      const res = await fetch(claimUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone, token }),
        signal: AbortSignal.timeout(10_000),
      })
      return res.json().catch(() => ({ ok: false }))
    },
    reply: async (message, text) => {
      try {
        const chat = await message.getChat()
        await chat.sendStateTyping()
        await new Promise((r) => setTimeout(r, 1000 + text.length * 25 + Math.random() * 1500))
      } catch {
        // cosmetic only
      }
      await message.reply(text)
    },
  })
  client.on('message', (message) => {
    onMessage(message).catch((err) => console.error('inbound error:', err instanceof Error ? err.message : 'unknown'))
  })
  console.log('click-to-chat login enabled')
}

await client.initialize()
