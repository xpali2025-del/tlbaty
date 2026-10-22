// دليل المقاسات: جدول قياسات الجسم (بالسنتيمتر) لكل مقاس. بلا اعتماد على الخادم: تستعمله اللوحة والمتجر والاختبارات.
//
// كل مقاس له مدى (من–إلى) لكل قياس، لأن جسم العميل يقع بين قيمتين لا على رقم واحد.
// «اعرف مقاسك» يقارن قياسات العميل بالمدى ويعيد الأقرب مع تنبيه إن وقع بين مقاسين.

export type SizeChartColumn = { key: string; label: string }
export type SizeChartRow = { size: string; ranges: Record<string, [number, number]> }
export type SizeChart = { name: string; columns: SizeChartColumn[]; rows: SizeChartRow[] }

export const SIZE_CHART_LIMITS = { columns: 8, rows: 24, nameMax: 60, labelMax: 30, sizeMax: 12, minCm: 5, maxCm: 250 } as const

const col = (key: string, label: string): SizeChartColumn => ({ key, label })
const range = (min: number, max: number): [number, number] => [min, max]

/** جداول شائعة كنقطة بداية؛ تقديرات عامة وليست معيار مصنّع، يراجعها صاحب المتجر ويعدّلها لمقاساته. */
export const COMMON_SIZE_CHARTS: SizeChart[] = [
  {
    name: "ملابس نسائية",
    columns: [col("chest", "الصدر"), col("waist", "الخصر"), col("hip", "الورك")],
    rows: [
      { size: "XS", ranges: { chest: range(78, 82), waist: range(60, 64), hip: range(86, 90) } },
      { size: "S", ranges: { chest: range(83, 87), waist: range(65, 69), hip: range(91, 95) } },
      { size: "M", ranges: { chest: range(88, 92), waist: range(70, 74), hip: range(96, 100) } },
      { size: "L", ranges: { chest: range(93, 98), waist: range(75, 80), hip: range(101, 106) } },
      { size: "XL", ranges: { chest: range(99, 105), waist: range(81, 88), hip: range(107, 113) } },
      { size: "XXL", ranges: { chest: range(106, 113), waist: range(89, 97), hip: range(114, 121) } },
    ],
  },
  {
    name: "ملابس رجالية",
    columns: [col("chest", "الصدر"), col("waist", "الخصر"), col("height", "الطول")],
    rows: [
      { size: "S", ranges: { chest: range(88, 94), waist: range(74, 80), height: range(160, 168) } },
      { size: "M", ranges: { chest: range(95, 101), waist: range(81, 87), height: range(166, 174) } },
      { size: "L", ranges: { chest: range(102, 108), waist: range(88, 94), height: range(172, 180) } },
      { size: "XL", ranges: { chest: range(109, 115), waist: range(95, 101), height: range(178, 186) } },
      { size: "XXL", ranges: { chest: range(116, 122), waist: range(102, 108), height: range(184, 192) } },
    ],
  },
  {
    name: "ملابس أطفال",
    columns: [col("height", "الطول"), col("chest", "الصدر"), col("waist", "الخصر")],
    rows: [
      { size: "2", ranges: { height: range(86, 92), chest: range(52, 54), waist: range(50, 52) } },
      { size: "4", ranges: { height: range(98, 104), chest: range(55, 57), waist: range(52, 54) } },
      { size: "6", ranges: { height: range(110, 116), chest: range(58, 61), waist: range(54, 56) } },
      { size: "8", ranges: { height: range(122, 128), chest: range(62, 65), waist: range(56, 58) } },
      { size: "10", ranges: { height: range(134, 140), chest: range(66, 70), waist: range(58, 61) } },
      { size: "12", ranges: { height: range(146, 152), chest: range(71, 75), waist: range(62, 65) } },
      { size: "14", ranges: { height: range(156, 164), chest: range(76, 80), waist: range(66, 69) } },
    ],
  },
  {
    name: "أحذية",
    columns: [col("foot", "طول القدم")],
    rows: [
      { size: "36", ranges: { foot: range(22.5, 23) } },
      { size: "37", ranges: { foot: range(23.1, 23.6) } },
      { size: "38", ranges: { foot: range(23.7, 24.3) } },
      { size: "39", ranges: { foot: range(24.4, 25) } },
      { size: "40", ranges: { foot: range(25.1, 25.6) } },
      { size: "41", ranges: { foot: range(25.7, 26.3) } },
      { size: "42", ranges: { foot: range(26.4, 27) } },
      { size: "43", ranges: { foot: range(27.1, 27.6) } },
      { size: "44", ranges: { foot: range(27.7, 28.3) } },
      { size: "45", ranges: { foot: range(28.4, 29) } },
    ],
  },
]

/** يتحقق من جدول قادم من اللوحة. يعيد رسالة الخطأ العربية أو null. */
export function validateSizeChart(chart: SizeChart): string | null {
  const L = SIZE_CHART_LIMITS
  if (!chart.name.trim() || chart.name.length > L.nameMax) return `اسم الجدول مطلوب (حتى ${L.nameMax} حرفاً)`
  if (chart.columns.length < 1 || chart.columns.length > L.columns) return `عدد القياسات من 1 إلى ${L.columns}`
  const keys = new Set<string>()
  for (const c of chart.columns) {
    if (!/^[a-z][a-z0-9_]{0,19}$/.test(c.key)) return "مفتاح قياس غير صالح"
    if (keys.has(c.key)) return "قياس مكرر في الجدول"
    keys.add(c.key)
    if (!c.label.trim() || c.label.length > L.labelMax) return `اسم القياس مطلوب (حتى ${L.labelMax} حرفاً)`
  }
  if (chart.rows.length < 1 || chart.rows.length > L.rows) return `عدد المقاسات من 1 إلى ${L.rows}`
  const sizes = new Set<string>()
  for (const r of chart.rows) {
    const size = r.size.trim()
    if (!size || size.length > L.sizeMax) return `اسم المقاس مطلوب (حتى ${L.sizeMax} أحرف)`
    if (sizes.has(size.toLowerCase())) return `المقاس "${size}" مكرر`
    sizes.add(size.toLowerCase())
    for (const c of chart.columns) {
      const v = r.ranges[c.key]
      if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => Number.isFinite(n))) return `أدخل مدى ${c.label} للمقاس ${size}`
      if (v[0] < L.minCm || v[1] > L.maxCm || v[0] > v[1]) return `مدى ${c.label} للمقاس ${size} غير صالح (من ${L.minCm} إلى ${L.maxCm} سم، والبداية ≤ النهاية)`
    }
  }
  return null
}

/** يعيد جدولاً بقيم منظّفة (نصوص مقصوصة وأرقام) أو null إن لم يكن بشكل الجدول. لا يتحقق من المعنى (validateSizeChart). */
export function parseSizeChart(value: unknown): SizeChart | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.name !== "string" || !Array.isArray(v.columns) || !Array.isArray(v.rows)) return null
  const columns: SizeChartColumn[] = []
  for (const c of v.columns) {
    if (typeof c !== "object" || c === null || typeof (c as Record<string, unknown>).key !== "string" || typeof (c as Record<string, unknown>).label !== "string") return null
    columns.push({ key: (c as SizeChartColumn).key, label: (c as SizeChartColumn).label.trim() })
  }
  const rows: SizeChartRow[] = []
  for (const r of v.rows) {
    if (typeof r !== "object" || r === null || typeof (r as Record<string, unknown>).size !== "string" || typeof (r as Record<string, unknown>).ranges !== "object" || (r as Record<string, unknown>).ranges === null) return null
    const ranges: Record<string, [number, number]> = {}
    for (const [k, pair] of Object.entries((r as { ranges: Record<string, unknown> }).ranges)) {
      if (!Array.isArray(pair) || pair.length !== 2) return null
      ranges[k] = [Number(pair[0]), Number(pair[1])]
    }
    rows.push({ size: (r as SizeChartRow).size.trim(), ranges })
  }
  return { name: v.name.trim(), columns, rows }
}

export type SizeRecommendation = {
  /** أقرب مقاس لقياسات العميل. */
  size: string
  /** مقاس ثانٍ قريب جداً (العميل بين مقاسين). */
  alternate: string | null
  /** كل القياسات المُدخلة داخل مدى المقاس. */
  exact: boolean
}

/**
 * يقترح المقاس: لكل مقاس مجموع بُعد القياسات المُدخلة عن مداه (0 إن وقعت داخله)، ويُختار الأقل.
 * «بين مقاسين»: مقاس آخر بالدرجة نفسها (تداخل المدى) أو أقرب من 2 سم إجمالاً. لا يوصي إن لم يُدخل العميل قياساً صالحاً.
 */
export function recommendSize(chart: SizeChart, input: Record<string, number | undefined>): SizeRecommendation | null {
  const given = chart.columns.filter((c) => {
    const n = input[c.key]
    return typeof n === "number" && Number.isFinite(n) && n > 0
  })
  if (given.length === 0 || chart.rows.length === 0) return null

  const scored = chart.rows.map((row, index) => {
    let distance = 0
    for (const c of given) {
      const [min, max] = row.ranges[c.key] ?? [0, 0]
      const n = input[c.key] as number
      distance += n < min ? min - n : n > max ? n - max : 0
    }
    return { size: row.size, distance, index }
  })
  // عند التساوي نفضّل المقاس الأكبر (أريح للعميل بين مقاسين).
  const sorted = [...scored].sort((a, b) => a.distance - b.distance || b.index - a.index)
  const best = sorted[0]
  const second = sorted[1]
  const alternate = second && second.distance - best.distance <= 2 && (best.distance === 0 ? second.distance === 0 : true) ? second.size : null
  return { size: best.size, alternate: alternate && alternate !== best.size ? alternate : null, exact: best.distance === 0 }
}
