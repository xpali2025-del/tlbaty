// رموز المنتجات السهلة الحفظ: رمز القسم + رقم تسلسلي قصير، مثل DR-012.
// الملف خالٍ من أي اعتماد على الخادم: يُستخدم في اللوحة والمتجر والبحث والسكربتات.
//
// - الرقم التسلسلي لكل قسم يزيد فقط ولا يُعاد استخدامه بعد الحذف، فيبقى الرمز ثابتاً لمنتجه.
// - نقل المنتج لقسم آخر لا يغيّر رمزه (الرمز هوية، لا تصنيف).

const CODE_RE = /^[A-Z]{2,4}[0-9]?$/
/** رمز منتج كامل: حروف القسم ثم شرطة ثم رقم (3 خانات على الأقل). */
const PRODUCT_CODE_RE = /^([A-Z]{2,4}[0-9]?)-(\d{3,})$/

export function isCategoryCode(value: unknown): value is string {
  return typeof value === "string" && CODE_RE.test(value)
}

export function isProductCode(value: unknown): value is string {
  return typeof value === "string" && PRODUCT_CODE_RE.test(value)
}

/** DR + 12 → DR-012 */
export function formatProductCode(categoryCode: string, seq: number): string {
  return `${categoryCode}-${String(Math.max(1, Math.trunc(seq))).padStart(3, "0")}`
}

/**
 * يقترح رمز قسم من الـslug (أول 3 أحرف لاتينية)، ويتفادى الرموز المحجوزة بإبدال آخر حرف برقم.
 * السلاج العربي بلا أحرف لاتينية يأخذ CT ثم CT2 … وللمدير تعديله من نموذج القسم.
 */
export function suggestCategoryCode(slug: string, taken: ReadonlySet<string>): string {
  const letters = slug.toUpperCase().replace(/[^A-Z]/g, "")
  const base = letters.length >= 2 ? letters.slice(0, 3) : "CT"
  if (!taken.has(base)) return base
  for (let n = 2; n <= 9; n++) {
    const candidate = `${base.slice(0, 3)}${n}`
    if (!taken.has(candidate)) return candidate
  }
  for (let n = 2; n <= 99; n++) {
    const candidate = `CT${n}`.slice(0, 4)
    if (!taken.has(candidate)) return candidate
  }
  throw new Error("تعذّر توليد رمز قسم فريد")
}

/** يوحّد الأرقام العربية والهندية إلى لاتينية، ليُقبل البحث برقم مكتوب بلوحة مفاتيح عربية. */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
}

/**
 * رموز المنتجات المحتملة التي يقصدها نص البحث (dr12 / DR 12 / dr-012 / DR_0012)، أو مصفوفة فارغة
 * إن لم يشبه رمزاً (فيُعامل كبحث نصي عادي). الغموض: «WOM212» قد تكون WOM-212 أو WOM2-012،
 * فنعيد الاحتمالين ويجرّبهما البحث على المنتجات الفعلية.
 */
export function codeQueryCandidates(query: string): string[] {
  const q = toLatinDigits(query).trim().toUpperCase()
  const m = /^([A-Z]{2,4})([0-9]?)([\s_-]*)0*(\d{1,6})$/.exec(q)
  if (!m) return []
  const [, letters, digit, sep, rest] = m
  const out: string[] = []
  if (sep || !digit) {
    // فاصل صريح أو بلا رقم ملتصق بالحروف: القسم حروف فقط (أو الحرف+الرقم إن وُجد الفاصل)
    if (digit) out.push(formatProductCode(letters + digit, Number(rest)))
    else out.push(formatProductCode(letters, Number(rest)))
    return out
  }
  out.push(formatProductCode(letters, Number(digit + rest)))
  if (rest) out.push(formatProductCode(letters + digit, Number(rest)))
  return out
}

/** أول احتمال لرمز المنتج (للعرض والاختبار). */
export function canonicalCodeQuery(query: string): string | null {
  return codeQueryCandidates(query)[0] ?? null
}
