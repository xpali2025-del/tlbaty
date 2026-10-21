import path from "node:path"
import { isImageFolder, type ImageFolder } from "../../lib/storage/keys"

// ============================================
// حلّ صور الترحيل: مسار الصورة في بيانات JSON (مثل /products/x.jpg) ← القيمة التي تُخزَّن.
//
// الترتيب: ذاكرة مؤقتة ← ملف محلي في public/ ← Sanity CDN (إن عُرف معرّف الأصل والمشروع) ← مفقود.
// في وضع R2 تُرفع الصورة ويُخزَّن مفتاحها؛ في الوضع المحلي يُخزَّن المسار نفسه فقط
// إن كان الملف موجوداً (لتعمل الواجهة بملفات public قبل ضبط R2).
// ============================================

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
}

export const contentTypeFor = (file: string) => CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream"

/** مجلدات المصدر القديمة التي لا تطابق أسماء مجلدات R2. */
const FOLDER_ALIASES: Record<string, ImageFolder> = { slider: "slides", logo: "site", images: "site" }

/** /products/a b.jpg ← products/a-b.jpg (ثابت وقابل للإعادة، ضمن المجلدات المسموحة). */
export function r2KeyFor(publicPath: string): string {
  const clean = publicPath.replace(/^\/+/, "").replace(/\\/g, "/")
  const [first, ...rest] = clean.split("/")
  const folder = isImageFolder(first) ? first : (FOLDER_ALIASES[first] ?? "site")
  const file = (rest.length ? rest : [first]).join("-").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/\.\.+/g, ".")
  return `${folder}/${file}`
}

/** image-<hash>-<WxH>-<ext> ← https://cdn.sanity.io/images/<project>/<dataset>/<hash>-<WxH>.<ext> */
export function sanityAssetUrl(assetId: string, projectId: string, dataset: string): string | null {
  const m = /^image-([0-9a-f]+)-(\d+x\d+)-([a-z0-9]+)$/i.exec(assetId)
  if (!m) return null
  return `https://cdn.sanity.io/images/${projectId}/${dataset}/${m[1]}-${m[2]}.${m[3]}`
}

export type ResolverOptions = {
  publicDir: string
  fileExists: (absolutePath: string) => boolean
  readFile: (absolutePath: string) => Promise<Buffer>
  /** مسار ← قيمة مخزَّنة سابقاً (يُحدَّث أثناء التشغيل). */
  cache: Record<string, string>
  saveCache?: () => void
  /** يرفع إلى R2؛ بدونه يعمل الحلّال بالوضع المحلي. */
  upload?: (key: string, body: Buffer, contentType: string) => Promise<void>
  sanity?: {
    projectId: string
    dataset: string
    /** مسار الصورة ← معرّف أصل Sanity (من .upload-cache.json القديم أو من تصدير). */
    assetIds: Record<string, string>
    fetchBytes: (url: string) => Promise<Buffer | null>
  }
  log?: (message: string) => void
}

export function createImageResolver(options: ResolverOptions) {
  const { publicDir, cache, log = () => {} } = options

  return async function resolveImage(publicPath: string): Promise<string | null> {
    if (cache[publicPath]) return cache[publicPath]

    const absolute = path.join(publicDir, publicPath.replace(/^\/+/, ""))
    let body: Buffer | null = null
    let source = ""

    if (options.fileExists(absolute)) {
      source = "ملف محلي"
      if (options.upload) body = await options.readFile(absolute)
      else {
        cache[publicPath] = publicPath
        return publicPath
      }
    } else if (options.sanity && options.upload) {
      const assetId = options.sanity.assetIds[publicPath]
      const url = assetId ? sanityAssetUrl(assetId, options.sanity.projectId, options.sanity.dataset) : null
      if (url) {
        body = await options.sanity.fetchBytes(url)
        source = "Sanity CDN"
      }
    }

    if (!body || !options.upload) return null

    const key = r2KeyFor(publicPath)
    await options.upload(key, body, contentTypeFor(publicPath))
    cache[publicPath] = key
    options.saveCache?.()
    log(`رفع ${publicPath} → ${key} (${source})`)
    return key
  }
}
