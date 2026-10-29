import { MAX_VIDEO_BYTES } from '@/lib/ads'
import { TRIM_VIDEO_SECONDS } from './video-input'

self.onmessage = async (event: MessageEvent<{ file: File; trim: boolean; remux: boolean }>) => {
  let input: import('mediabunny').Input | undefined
  try {
    const { file, trim, remux } = event.data
    const { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, Conversion, Quality } = await import('mediabunny')
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error()
    const width = await track.getDisplayWidth(), height = await track.getDisplayHeight()
    const duration = await input.computeDuration()
    if (!Number.isFinite(duration) || duration <= 0 || duration > 600 || width <= 0 || height <= 0 || width * height > 4096 * 2160 || Math.max(width, height) > 4096) throw new Error()
    const scale = Math.min(1, 1280 / Math.max(width, height), 720 / Math.min(width, height))
    const w = Math.max(2, Math.floor(width * scale / 2) * 2), h = Math.max(2, Math.floor(height * scale / 2) * 2)
    if (!remux) {
      if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') throw new Error()
      const support = await VideoEncoder.isConfigSupported({ codec: 'avc1.42001f', width: w, height: h, bitrate: 1_500_000, framerate: 30 })
      if (!support.supported || !await track.canDecode()) throw new Error()
    }
    const target = new BufferTarget()
    const output = new Output({ target, format: new Mp4OutputFormat({ fastStart: 'in-memory' }) })
    const conversion = await Conversion.init({
      input, output, tracks: 'primary', audio: { discard: true }, tags: {}, showWarnings: false,
      trim: trim ? { start: 0, end: TRIM_VIDEO_SECONDS } : undefined,
      video: remux ? { codec: 'avc' } : { codec: 'avc', width: w, height: h, fit: 'contain', frameRate: 30, quality: new Quality({ bitrate: 1_500_000 }), forceTranscode: true, allowTransformationMetadata: false },
    })
    if (!conversion.isValid) throw new Error()
    conversion.onProgress = progress => self.postMessage({ type: 'progress', progress })
    await conversion.execute()
    if (!target.buffer || target.buffer.byteLength > MAX_VIDEO_BYTES) throw new Error()
    self.postMessage({ type: 'done', file: new File([target.buffer], 'ad-video.mp4', { type: 'video/mp4' }) })
  } catch {
    self.postMessage({ type: 'error' })
  } finally { input?.dispose() }
}
