// يولّد صور اختبار «شبيهة بصور الجوال» (4000×3000 JPEG بحجم ~4 ميغابايت) في المجلد المعطى.
// الاستخدام: node scripts/bench/make-fixtures.mjs <outDir> [count=3]
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomFillSync } from "node:crypto"
import sharp from "sharp"

const [outDir, countArg] = process.argv.slice(2)
if (!outDir) throw new Error("usage: make-fixtures.mjs <outDir> [count]")
mkdirSync(outDir, { recursive: true })
const W = 4000
const H = 3000
const TARGET = { min: 3.6 * 1024 * 1024, max: 4.6 * 1024 * 1024 }

async function make(index) {
  // خلفية ناعمة متدرجة (كمشهد حقيقي) + ضجيج دقيق يرفع الحجم إلى ~4MB كصور الكاميرا
  const small = Buffer.alloc(200 * 150 * 3)
  randomFillSync(small)
  const base = await sharp(small, { raw: { width: 200, height: 150, channels: 3 } })
    .resize(W, H, { kernel: "cubic" })
    .raw()
    .toBuffer()
  const noise = Buffer.alloc(base.length)
  randomFillSync(noise)
  for (const amp of [4, 6, 8, 10, 13, 16, 20, 26]) {
    const px = Buffer.allocUnsafe(base.length)
    for (let i = 0; i < base.length; i++) {
      const v = base[i] + ((noise[i] - 128) * amp) / 128
      px[i] = v < 0 ? 0 : v > 255 ? 255 : v
    }
    const jpg = await sharp(px, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90 }).toBuffer()
    if (jpg.length >= TARGET.min || amp === 26) {
      const file = join(outDir, `photo-${index + 1}.jpg`)
      writeFileSync(file, jpg)
      console.log(`${file}  ${(jpg.length / 1024 / 1024).toFixed(2)} MB  (noise ${amp})`)
      return
    }
  }
}

for (let i = 0; i < Number(countArg ?? 3); i++) await make(i)
