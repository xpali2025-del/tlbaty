import "server-only"
import { readFile, rename, writeFile } from "node:fs/promises"
import type { OtpProvider, SendOtpInput, SendOtpResult } from "../provider"

// مصرف رموز للاختبارات الشاملة فقط: يكتب الرمز إلى ملف JSON ({ [الهاتف]: الرمز }) بدل إرساله.
// لا يعمل إلا مع OTP_TEST_SINK ومع غياب VERCEL، فلا يمكن تفعيله في الإنتاج. الرمز يكتب على القرص عمداً،
// ولذلك تعرض صفحة الفحص صفاً أحمر إن كان مفعّلاً.

let warned = false

export function testSinkPath(): string | null {
  const path = process.env.OTP_TEST_SINK?.trim()
  if (!path || process.env.VERCEL) return null
  return path
}

export const testSinkProvider: OtpProvider = {
  name: "test-sink",
  async send(input: SendOtpInput): Promise<SendOtpResult> {
    const path = testSinkPath()
    if (!path) return { ok: false, provider: "test-sink", errorCode: "SINK_INACTIVE" }
    if (!warned) {
      warned = true
      console.warn("[otp] TEST SINK ACTIVE: codes are written to disk")
    }
    try {
      let codes: Record<string, string> = {}
      try {
        codes = JSON.parse(await readFile(path, "utf8")) as Record<string, string>
      } catch {
        // الملف غير موجود بعد أو تالف: نبدأ من جديد
      }
      codes[input.phone] = input.code
      const tmp = `${path}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(codes))
      await rename(tmp, path)
      return { ok: true, provider: "test-sink" }
    } catch {
      return { ok: false, provider: "test-sink", errorCode: "SINK_WRITE_FAILED" }
    }
  },
}
