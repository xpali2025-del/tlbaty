// بصمة الألوان للبحث بالصورة — منطق خالص (بلا DOM ولا sharp)، يعمل في المتصفح (صورة المستخدم)
// وعلى الخادم (صور المنتجات) بنفس الخوارزمية، فتتطابق البصمتان.
//
// الفكرة: نستخرج أبرز 4 ألوان في الصورة (مع وزن كل لون) متجاهلين خلفية المنتج البيضاء/الرمادية الفاتحة،
// ثم نقارن بصمة صورة المستخدم ببصمة كل منتج في فضاء Lab (أقرب لإدراك العين من RGB).
// هذا يطابق اللون والمظهر العام، ولا يتعرّف على نوع القطعة (فستان/حقيبة) — لذلك يُدمج مع فلتر القسم.

export type PaletteColor = { hex: string; weight: number }

const MAX_COLORS = 4
const MERGE_DISTANCE = 28 // بالمسافة اللونية في Lab

type Rgb = [number, number, number]

const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** sRGB → CIE Lab (D65). */
export function rgbToLab([r, g, b]: Rgb): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function colorDistance(a: string, b: string): number {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  if (!ra || !rb) return 100
  const [l1, a1, b1] = rgbToLab(ra)
  const [l2, a2, b2] = rgbToLab(rb)
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2)
}

/** خلفية المنتج: أبيض/رمادي فاتح بلا تشبّع يُهمل حتى لا تتشابه كل الصور. */
function isBackground(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return min > 225 || (max > 200 && max - min < 14)
}

/**
 * يستخرج بصمة الألوان من بكسلات RGBA (Uint8ClampedArray من canvas أو Buffer من sharp).
 * stride: كل كم بكسل نأخذ عيّنة (الصورة تُصغَّر مسبقاً إلى ~64px، فالافتراضي 1).
 */
export function extractPalette(rgba: ArrayLike<number>, stride = 1): PaletteColor[] {
  const bins = new Map<number, { r: number; g: number; b: number; n: number }>()
  let kept = 0
  const collect = (skipBackground: boolean) => {
    for (let i = 0; i + 3 < rgba.length; i += 4 * stride) {
      if (rgba[i + 3] < 128) continue
      const r = rgba[i]
      const g = rgba[i + 1]
      const b = rgba[i + 2]
      if (skipBackground && isBackground(r, g, b)) continue
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const bin = bins.get(key)
      if (bin) {
        bin.r += r
        bin.g += g
        bin.b += b
        bin.n += 1
      } else bins.set(key, { r, g, b, n: 1 })
      kept++
    }
  }
  collect(true)
  // صورة كلها خلفية (منتج أبيض): نعيد المحاولة بلا استبعاد.
  if (kept < 20) {
    bins.clear()
    kept = 0
    collect(false)
  }
  if (kept === 0) return []

  const sorted = [...bins.values()].sort((a, b) => b.n - a.n)
  const merged: { rgb: Rgb; n: number }[] = []
  for (const bin of sorted) {
    const rgb: Rgb = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n]
    const hit = merged.find((m) => colorDistance(toHex(m.rgb), toHex(rgb)) < MERGE_DISTANCE)
    if (hit) {
      const total = hit.n + bin.n
      hit.rgb = [(hit.rgb[0] * hit.n + rgb[0] * bin.n) / total, (hit.rgb[1] * hit.n + rgb[1] * bin.n) / total, (hit.rgb[2] * hit.n + rgb[2] * bin.n) / total]
      hit.n = total
    } else merged.push({ rgb, n: bin.n })
  }
  const top = merged.sort((a, b) => b.n - a.n).slice(0, MAX_COLORS)
  const sum = top.reduce((s, c) => s + c.n, 0)
  return top.map((c) => ({ hex: toHex(c.rgb), weight: Number((c.n / sum).toFixed(3)) }))
}

/** يتحقق من بصمة قادمة من متصفح (لا نثق بها): ألوان صالحة وأوزان معقولة. */
export function sanitizePalette(input: unknown): PaletteColor[] {
  if (!Array.isArray(input)) return []
  const out: PaletteColor[] = []
  for (const item of input.slice(0, 32)) {
    if (out.length >= MAX_COLORS) break
    const hex = typeof item?.hex === "string" ? item.hex.toLowerCase() : ""
    const weight = Number(item?.weight)
    if (!/^#[0-9a-f]{6}$/.test(hex) || !Number.isFinite(weight) || weight <= 0) continue
    out.push({ hex, weight: Math.min(1, weight) })
  }
  const sum = out.reduce((s, c) => s + c.weight, 0)
  return sum > 0 ? out.map((c) => ({ hex: c.hex, weight: Number((c.weight / sum).toFixed(3)) })) : []
}

/** أقصى فرق لوني يُعدّ «قريباً» (فوقه التشابه صفر). */
const FAR = 55

/**
 * تشابه بصمتين من 0 إلى 1: لكل لون في صورة المستخدم أقرب لون في بصمة المنتج، موزوناً بحصته.
 * بصمة المنتج الفارغة تعطي 0.
 */
export function paletteSimilarity(query: PaletteColor[], product: PaletteColor[]): number {
  if (query.length === 0 || product.length === 0) return 0
  let score = 0
  for (const q of query) {
    let best = FAR
    for (const p of product) best = Math.min(best, colorDistance(q.hex, p.hex))
    score += q.weight * Math.max(0, 1 - best / FAR)
  }
  // بصمة المنتج يجب أن تتغطى أيضاً (تماثل ثنائي الاتجاه): صورة حمراء لا تطابق منتجاً نصفه أزرق جيداً.
  let reverse = 0
  for (const p of product) {
    let best = FAR
    for (const q of query) best = Math.min(best, colorDistance(q.hex, p.hex))
    reverse += p.weight * Math.max(0, 1 - best / FAR)
  }
  return Number(((score + reverse) / 2).toFixed(4))
}
