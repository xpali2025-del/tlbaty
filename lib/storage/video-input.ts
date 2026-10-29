import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS } from '@/lib/ads'
export const TRIM_VIDEO_SECONDS = MAX_VIDEO_SECONDS
export const MAX_RAW_VIDEO_BYTES = 200 * 1024 * 1024
export const CONVERSION_ERROR = 'تعذّر تحويل الفيديو في هذا المتصفح. اضغطه بصيغة MP4 (H.264) إلى أقل من 8 ميغابايت و20 ثانية ثم أعد الرفع.'
export function inputVideoType(file: { type: string; name: string }) {
  if (file.type) return file.type
  return /\.mp4$/i.test(file.name) ? 'video/mp4' : /\.mov$/i.test(file.name) ? 'video/quicktime' : /\.webm$/i.test(file.name) ? 'video/webm' : ''
}
export function validateVideoInput(file: { type: string; name: string; size: number }) {
  if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(inputVideoType(file))) return 'اختر فيديو MP4 أو MOV أو WebM'
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_RAW_VIDEO_BYTES) return 'اختر فيديو لا يتجاوز 200 ميغابايت'
  return null
}
export function isVideoFastPath(info: { type: string; size: number; duration: number; h264: boolean }) {
  return info.type === 'video/mp4' && info.h264 && info.size > 0 && info.size <= MAX_VIDEO_BYTES && Number.isFinite(info.duration) && info.duration > 0 && info.duration <= MAX_VIDEO_SECONDS
}
/** Read bounded ISO-BMFF boxes, never scan compressed media bytes for codec names. */
export async function inspectMp4(file: Blob): Promise<{ h264: boolean; fastStart: boolean }> {
  let moov = -1; let mdat = -1; let h264 = false
  for (let offset = 0, boxes = 0; offset + 8 <= file.size && boxes++ < 10000;) {
    const head = new DataView(await file.slice(offset, offset + 16).arrayBuffer())
    const type = String.fromCharCode(...new Uint8Array(head.buffer, 4, 4))
    const size32 = head.getUint32(0)
    const size = size32 === 1 ? Number(head.getBigUint64(8)) : size32 || file.size - offset
    const header = size32 === 1 ? 16 : 8
    if (!Number.isSafeInteger(size) || size < header || offset + size > file.size) break
    if (type === 'mdat' && mdat < 0) mdat = offset
    if (type === 'moov' && size <= 4 * 1024 * 1024) {
      moov = offset
      const data = new DataView(await file.slice(offset + header, offset + size).arrayBuffer())
      const codecs: string[] = []
      const walk = (start: number, end: number, depth: number) => {
        if (depth > 8) return
        for (let pos = start; pos + 8 <= end;) {
          const length = data.getUint32(pos)
          if (length < 8 || pos + length > end) return
          const kind = String.fromCharCode(...new Uint8Array(data.buffer, pos + 4, 4))
          if (['trak', 'mdia', 'minf', 'stbl'].includes(kind)) walk(pos + 8, pos + length, depth + 1)
          if (kind === 'stsd' && length >= 16) {
            for (let entry = pos + 16; entry + 8 <= pos + length;) {
              const len = data.getUint32(entry)
              if (len < 8 || entry + len > pos + length) break
              codecs.push(String.fromCharCode(...new Uint8Array(data.buffer, entry + 4, 4)))
              entry += len
            }
          }
          pos += length
        }
      }
      walk(0, data.byteLength, 0)
      h264 = codecs.some(c => c === 'avc1' || c === 'avc3') && codecs.every(c => ['avc1', 'avc3', 'mp4a', 'ac-3', 'ec-3', 'Opus'].includes(c))
    }
    offset += size
  }
  return { h264, fastStart: moov >= 0 && mdat > moov }
}
