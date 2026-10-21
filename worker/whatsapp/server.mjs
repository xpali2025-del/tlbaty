// WhatsApp OTP sender (whatsapp-web.js). Runs as a long-lived process on its own host —
// NOT on Vercel/serverless. See README.md for setup, risks and hardening.
import http from 'node:http'
import qrcode from 'qrcode-terminal'
import pkg from 'whatsapp-web.js'
import { createHandler } from './handler.mjs'

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

async function sendMessage(phone, text) {
  const id = await client.getNumberId(phone)
  if (!id) throw new Error('NOT_ON_WHATSAPP')
  await client.sendMessage(id._serialized, text)
}

const handler = createHandler({ token, sendMessage, isReady: () => ready })
http.createServer(handler).listen(port, host, () => console.log(`worker listening on ${host}:${port}`))

await client.initialize()
