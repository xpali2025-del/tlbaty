// فحص إعداد الموقع لصفحة /api/diagnose: أي متغير ناقص أو صيغته خطأ، دون إظهار أي قيمة سرية.
// منطق خالص (بلا قاعدة ولا شبكة) ليُختبر بسهولة.

export type EnvStatus = "ok" | "missing" | "invalid" | "optional"

export type EnvCheck = {
  name: string
  group: string
  status: EnvStatus
  /** سبب الخطأ أو ملاحظة، بلا القيمة نفسها. */
  note: string
  /** القيمة جاءت من الاسم البديل NAME_2. */
  fromAlias?: boolean
}

type Env = Record<string, string | undefined>

type Rule = {
  name: string
  group: string
  required: boolean
  /** يقرأه الكود أيضاً من NAME_2 (له الأولوية). */
  alias?: boolean
  purpose: string
  validate?: (value: string) => string | null
}

const PLACEHOLDERS = ["REGION", "PROJECT_REF", "[YOUR-PASSWORD]", "YOUR-PASSWORD", ":PASSWORD@"]

/** يفحص رابط قاعدة البيانات: الصيغة، والنصوص النموذجية المنسوخة كما هي من المثال. */
export function checkDatabaseUrl(value: string): string | null {
  const placeholder = PLACEHOLDERS.find((p) => value.includes(p))
  if (placeholder) return `الرابط ما زال يحتوي النص النموذجي «${placeholder.replace(/[:@]/g, "")}»: انسخ الرابط الحقيقي من Supabase ← Connect`
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return "ليس رابطاً صالحاً (يجب أن يبدأ بـ postgresql://)"
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return "يجب أن يبدأ بـ postgresql://"
  if (!url.password) return "الرابط بلا كلمة مرور"
  if (url.hostname.includes("pooler.supabase.com") && !url.username.includes(".")) return "رابط الـ pooler يحتاج اسم مستخدم بصيغة postgres.<رمز المشروع>"
  return null
}

const minLength = (n: number) => (v: string) => (v.trim().length >= n ? null : `قصير جداً: يجب ${n} حرفاً على الأقل`)
const isUrl = (v: string) => {
  try {
    new URL(v)
    return null
  } catch {
    return "ليس رابطاً صالحاً (يجب أن يبدأ بـ https://)"
  }
}

const RULES: Rule[] = [
  { name: "DATABASE_URL", group: "قاعدة البيانات", required: true, alias: true, purpose: "رابط قاعدة Supabase (Transaction pooler، المنفذ 6543)", validate: checkDatabaseUrl },
  { name: "DB_POOL_MAX", group: "قاعدة البيانات", required: false, purpose: "عدد الاتصالات لكل نسخة (اختياري، مثلاً 10)", validate: (v) => (/^\d+$/.test(v.trim()) ? null : "يجب أن يكون رقماً") },
  { name: "SESSION_SECRET", group: "الجلسات واللوحة", required: true, purpose: "سر توقيع جلسات العملاء (16 حرفاً عشوائياً على الأقل)", validate: minLength(16) },
  { name: "MANAGE_PASSWORD", group: "الجلسات واللوحة", required: true, purpose: "كلمة مرور لوحة الإدارة" },
  { name: "MANAGE_USERNAME", group: "الجلسات واللوحة", required: false, purpose: "اسم مستخدم المالك (الافتراضي odoo)" },
  { name: "MANAGE_SESSION_SECRET", group: "الجلسات واللوحة", required: false, purpose: "سر جلسات اللوحة (اختياري، 16 حرفاً)", validate: minLength(16) },
  { name: "CRON_SECRET", group: "الجلسات واللوحة", required: false, purpose: "للمهام المجدولة (تنظيف، تذكيرات). بدونه لا تعمل" },
  { name: "R2_ACCOUNT_ID", group: "رفع الصور (R2)", required: true, alias: true, purpose: "معرّف حساب Cloudflare" },
  { name: "R2_ACCESS_KEY_ID", group: "رفع الصور (R2)", required: true, alias: true, purpose: "مفتاح R2" },
  { name: "R2_SECRET_ACCESS_KEY", group: "رفع الصور (R2)", required: true, alias: true, purpose: "سر مفتاح R2" },
  { name: "R2_BUCKET", group: "رفع الصور (R2)", required: true, alias: true, purpose: "اسم bucket الصور" },
  { name: "R2_PUBLIC_URL", group: "رفع الصور (R2)", required: true, alias: true, purpose: "الرابط العام للصور", validate: isUrl },
  { name: "R2_PROOFS_BUCKET", group: "الدفع بالتحويل", required: false, alias: true, purpose: "bucket خاص لإثباتات التحويل (بدونه يُرفض الدفع بالتحويل)" },
  {
    name: "PAYMENT_PROOF_ENCRYPTION_KEY",
    group: "الدفع بالتحويل",
    required: false,
    purpose: "مفتاح تشفير إثباتات التحويل (32 بايت Base64). لا تغيّره بعد استعماله",
    validate: (v) => (Buffer.from(v.trim(), "base64").byteLength === 32 ? null : "يجب أن يكون 32 بايت بصيغة Base64 (مثلاً: openssl rand -base64 32)"),
  },
  { name: "OTP_PROVIDER", group: "رمز التحقق (لاحقاً)", required: false, purpose: "whatsapp أو sms (القناة تُختار أيضاً من اللوحة)", validate: (v) => (["whatsapp", "sms"].includes(v.trim().toLowerCase()) ? null : "القيم المقبولة: whatsapp أو sms") },
  { name: "WHATSAPP_WORKER_URL", group: "رمز التحقق (لاحقاً)", required: false, purpose: "رابط عامل واتساب", validate: isUrl },
  { name: "WHATSAPP_WORKER_TOKEN", group: "رمز التحقق (لاحقاً)", required: false, purpose: "توكن عامل واتساب" },
  { name: "SMS_GATE_USERNAME", group: "رمز التحقق (لاحقاً)", required: false, purpose: "حساب SMS Gateway for Android" },
  { name: "SMS_GATE_PASSWORD", group: "رمز التحقق (لاحقاً)", required: false, purpose: "كلمة مرور SMS Gateway" },
]

/** حالة كل متغير يقرؤه الموقع. */
export function checkEnv(env: Env): EnvCheck[] {
  return RULES.map((rule) => {
    const aliasValue = rule.alias ? env[`${rule.name}_2`]?.trim() : undefined
    const value = aliasValue || env[rule.name]?.trim()
    const fromAlias = Boolean(aliasValue)
    if (!value) {
      return { name: rule.name, group: rule.group, status: rule.required ? "missing" : "optional", note: rule.purpose }
    }
    const problem = rule.validate?.(value) ?? null
    const aliasNote = fromAlias ? ` (يُقرأ من ${rule.name}_2، وله الأولوية على ${rule.name})` : ""
    return problem
      ? { name: rule.name, group: rule.group, status: "invalid", note: problem + aliasNote, fromAlias }
      : { name: rule.name, group: rule.group, status: "ok", note: rule.purpose + aliasNote, fromAlias }
  })
}

// منطقة Supabase (من اسم مضيف الـ pooler) ← أقرب منطقة دوال في Vercel.
const VERCEL_REGION_FOR: Record<string, string> = {
  "us-east-1": "iad1",
  "us-east-2": "cle1",
  "us-west-1": "sfo1",
  "us-west-2": "pdx1",
  "ca-central-1": "yul1",
  "sa-east-1": "gru1",
  "eu-west-1": "dub1",
  "eu-west-2": "lhr1",
  "eu-west-3": "cdg1",
  "eu-central-1": "fra1",
  "eu-north-1": "arn1",
  "ap-south-1": "bom1",
  "ap-southeast-1": "sin1",
  "ap-southeast-2": "syd1",
  "ap-northeast-1": "hnd1",
  "ap-northeast-2": "icn1",
  "me-central-1": "dxb1",
}

/** منطقة قاعدة Supabase من رابطها، ومنطقة Vercel المقترحة لها. */
export function suggestRegion(databaseUrl: string | undefined): { dbRegion: string; vercelRegion: string | null } | null {
  if (!databaseUrl) return null
  let host: string
  try {
    host = new URL(databaseUrl).hostname
  } catch {
    return null
  }
  const match = host.match(/^aws-\d+-([a-z]+-[a-z]+-\d)\.pooler\.supabase\.com$/)
  if (!match) return null
  return { dbRegion: match[1], vercelRegion: VERCEL_REGION_FOR[match[1]] ?? null }
}

/** الترحيلات التي لم تُطبَّق: كما يفعل مُرحِّل drizzle، كل ترحيل أحدث من آخر ترحيل مسجَّل في القاعدة. */
export function pendingMigrations(journal: { tag: string; when: number }[], lastAppliedAt: number | null): string[] {
  return journal.filter((m) => lastAppliedAt === null || m.when > lastAppliedAt).map((m) => m.tag)
}
