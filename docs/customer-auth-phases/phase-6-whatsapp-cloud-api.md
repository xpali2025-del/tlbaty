# Phase 6: WhatsApp Business Platform (Cloud API) Channel

Read `README.md` first. Reference: plan §1.2, §3.1, §8 (WhatsApp Cloud row).

**Before starting, the store owner must provide:**
- a Meta business account with a WhatsApp Business phone number;
- an **authentication** template with a copy-code button, approved, in language `ar`;
- a system-user access token.

The agent can build and test everything with mocks. The live check (exit criteria) needs these values in Vercel.

## Goal
Method `wa_cloud` sends the code through Meta's official API with the approved authentication template. Optionally, a webhook records delivery status.

## Facts (verified)
- **Provider interface:** `OtpProvider { name; send(input) }` with `SendOtpInput { phone, code, purpose, timeoutMs? }` and `SendOtpResult { ok, provider, errorCode? }` [`lib/otp/provider.ts`].
- **`sendOtp()`** throws for `wa_cloud` since phase 1; replace that branch.
- **Readiness** for `wa_cloud` returns not ready since phase 5; replace it.

## Tasks

### 6.1 Config (Vercel env, all server-only)
`WA_CLOUD_TOKEN`, `WA_CLOUD_PHONE_NUMBER_ID`, `WA_CLOUD_TEMPLATE` (template name), `WA_CLOUD_TEMPLATE_LANG` (default `ar`), and `WA_CLOUD_APP_SECRET` (only for the webhook). Also:
- add them to `.env.example` and to `lib/diagnose.ts`, in a new group "واتساب الرسمي";
- `WA_CLOUD_TOKEN` is required only when the method is `wa_cloud`.

### 6.2 `lib/otp/providers/whatsapp-cloud.ts`
- **Graph API version:** one exported constant, `GRAPH_API_VERSION`. Check Meta's current stable version when implementing, and write the date checked in a comment.
- **`send()`:** `POST https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages` with `Authorization: Bearer ${TOKEN}` and this body:
  ```json
  {
    "messaging_product": "whatsapp",
    "to": "<phone digits, no +>",
    "type": "template",
    "template": {
      "name": "<WA_CLOUD_TEMPLATE>",
      "language": { "code": "<WA_CLOUD_TEMPLATE_LANG>" },
      "components": [
        { "type": "body", "parameters": [{ "type": "text", "text": "<code>" }] },
        { "type": "button", "sub_type": "url", "index": "0", "parameters": [{ "type": "text", "text": "<code>" }] }
      ]
    }
  }
  ```
  Check the exact component shape for copy-code authentication templates against Meta's current docs when implementing, and adjust the test fixture to match.
- **Timeout:** `timeoutMs` (default 8 s) through `AbortController`.
- **Result mapping:**
  - 2xx with `messages[0].id` → `{ ok: true, provider: "wa_cloud" }`;
  - timeout → `errorCode: "TIMEOUT"`;
  - HTTP 401 or 403 → `"AUTH"`;
  - 429 → `"RATE_LIMITED"`;
  - error code `131026` (undeliverable) → `"UNDELIVERABLE"`;
  - other errors → `"API_ERROR"`.
  - Never include the code or the token in the result or the logs.
- **`readiness()`:** env present, plus `GET /${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/message_templates?name=<template>` (or the WABA templates endpoint, whichever Meta documents for the token type) returns a template with `status = "APPROVED"` and category `AUTHENTICATION`.
  - Problems in Arabic: "القالب غير معتمد بعد", "القالب ليس من فئة المصادقة", "رمز Meta غير صالح".

### 6.3 Optional webhook: `app/api/webhooks/whatsapp/route.ts`
- **`GET` (Meta verification):** echo `hub.challenge` when `hub.verify_token` equals `WA_CLOUD_VERIFY_TOKEN`; otherwise 403.
- **`POST`:**
  - verify `X-Hub-Signature-256: sha256=<hex>`, the HMAC-SHA256 of the **raw** body with `WA_CLOUD_APP_SECRET`, using `timingSafeEqual`; on failure → 401;
  - on `statuses[].status = "failed"`, audit `otp_failed` with `detail = "wa_cloud:<error code>"` (no phone digits beyond the last 2);
  - always 200 quickly; no heavy work.

## Tests

### `tests/otp-whatsapp-cloud.test.ts` (new, `fetch` mocked)
1. `sends the authentication template with the code in body and button`: assert the URL, the method, the auth header, and the JSON body deep-equals the fixture.
2. `maps 200 with a message id to ok`.
3. `maps 401/403 to AUTH, 429 to RATE_LIMITED, 131026 to UNDELIVERABLE, others to API_ERROR`.
4. `aborts after timeoutMs with TIMEOUT` (fake timers).
5. `never logs the code or the token`: spy on `console.error` and `console.log` across all failure cases; no output contains the code or the token.
6. `sendOtp uses the cloud provider when the method is wa_cloud`.
7. `readiness`: approved authentication template → ready; `PENDING` → "القالب غير معتمد بعد"; category `UTILITY` → "القالب ليس من فئة المصادقة"; 401 → "رمز Meta غير صالح"; missing env → the env problem; never throws.

### `tests/whatsapp-webhook.test.ts` (new)
1. `verification echoes the challenge only with the right verify token`.
2. `rejects a bad or missing signature with 401`.
3. `accepts a valid signature computed over the raw body` (a re-serialised body must fail, proving raw-body use).
4. `records a failed status without the phone digits`.

## Exit criteria
- [ ] All tests pass.
- [ ] Live check with the store's real values: 20 sends to Yemen and Saudi Arabia numbers; at least 19 arrive within 10 s. Record the numbers in the PR with only the last 2 digits.
- [ ] `/api/diagnose` and the method card show `wa_cloud` as ready only when the template is approved.

## Rollback
Switch the method to `wa_web` or `sms` in the panel. The code can stay deployed.
