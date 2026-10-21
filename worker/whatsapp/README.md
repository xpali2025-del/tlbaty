# WhatsApp OTP worker (whatsapp-web.js)

Sends login codes for the Next.js app through a WhatsApp Web session. It is a separate
process because it needs a persistent browser session; it cannot run on Vercel/serverless.

## Read this first: risks
- **This is unofficial automation and is against WhatsApp's terms.** The number can be banned at any time.
- **Use a dedicated number, never the store's main customer-support number.** If it is banned, only login codes stop.
- The linked session grants access to that WhatsApp account. Keep the host locked down and the number free of other chats.
- Keep a fallback (e.g. email login or the official WhatsApp Business API) for when the number is banned or the session drops.

## Setup
1. On a small always-on host (VPS/Docker) with Node 20+: `cd worker/whatsapp && npm install`.
2. Set `WHATSAPP_WORKER_TOKEN` (random, 32+ chars; must equal the app's value), optionally `HOST`, `PORT` (default `127.0.0.1:3100`), `WWEBJS_DATA_PATH`.
3. `npm start`, scan the QR printed in the terminal (WhatsApp > Linked devices). The session persists in `WWEBJS_DATA_PATH` (keep it private and backed up).
4. Run it under a supervisor (pm2/systemd/Docker `restart: always`); the process exits on disconnect so it restarts.
5. Expose it to the app over HTTPS only (reverse proxy or a Cloudflare Tunnel), then set in the app: `WHATSAPP_WORKER_URL`, `WHATSAPP_WORKER_TOKEN`, `OTP_PROVIDER=whatsapp`, `SESSION_SECRET`.

## API
- `POST /send` with `Authorization: Bearer <token>` and JSON `{ "phone": "781234567", "text": "..." }` (9-digit Yemeni local number; `967` is added).
  Responses: `200 ok`, `400` invalid input, `401` bad token, `422 NOT_ON_WHATSAPP`, `502 SEND_FAILED`, `503 NOT_READY`.
- `GET /health` -> `{ ok, ready }`.

Codes are never logged. Sends are serialised with a 3s+ gap to avoid burst patterns.
The request logic is unit-tested in `tests/whatsapp-worker.test.ts`; the WhatsApp connection itself
cannot be tested without a real number and must be verified by scanning the QR and sending a code.
