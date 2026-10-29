import { describe, expect, it, vi } from 'vitest'
import { uploadAdVideo } from '@/lib/storage/video-client'
import { MAX_VIDEO_BYTES, validateVideoFile } from '@/lib/ads'
import { inputVideoType, isVideoFastPath, validateVideoInput, inspectMp4 } from '@/lib/storage/video-input'
import type { PutOptions } from '@/lib/storage/put'
const file = new File(['data'], 'ad.mp4', { type: 'video/mp4' })
describe('video upload', () => {
  it('passes progress and renews the same key using its ticket', async () => {
    const request = vi.fn().mockResolvedValue({ uploadUrl: 'url', objectKey: 'ads/a.mp4', ticket: 'signed' })
    const onProgress = vi.fn()
    const put = vi.fn(async (_: string, __: File, options?: PutOptions) => { options?.onProgress?.(0.5); await options?.resign?.() })
    expect(await uploadAdVideo(file, { request, put }, { onProgress })).toBe('ads/a.mp4')
    expect(request).toHaveBeenLastCalledWith('video/mp4', 4, 'signed')
    expect(onProgress).toHaveBeenCalledWith(0.5)
  })
  it('does not start a cancelled upload', async () => {
    const controller = new AbortController(); controller.abort()
    const request = vi.fn(), put = vi.fn()
    await expect(uploadAdVideo(file, { request, put }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).not.toHaveBeenCalled()
  })
  it('rejects a changed key on renewal', async () => {
    const request = vi.fn().mockResolvedValueOnce({ uploadUrl: 'a', objectKey: 'ads/a.mp4', ticket: 'signed' }).mockResolvedValueOnce({ uploadUrl: 'b', objectKey: 'ads/b.mp4' })
    await expect(uploadAdVideo(file, { request, put: async (_, __, options) => { await options?.resign?.() } })).rejects.toThrow('تغيّر')
  })
  it.each([{ type: 'video/webm', size: 1 }, { type: 'video/mp4', size: MAX_VIDEO_BYTES + 1 }, { type: 'video/mp4', size: 1, duration: 21 }])('keeps output validation authoritative: %j', info => {
    expect(validateVideoFile(info)).not.toBeNull()
  })
  it('detects empty MIME by extension but retains strict output rules', () => {
    expect(inputVideoType({ name: 'phone.MOV', type: '' })).toBe('video/quicktime')
    expect(validateVideoInput({ name: 'phone.MOV', type: '', size: 25 * 1024 * 1024 })).toBeNull()
    expect(validateVideoInput({ name: 'phone.mp4', type: '', size: 201 * 1024 * 1024 })).not.toBeNull()
  })
  it('only skips re-encoding for compliant H264 MP4', () => {
    const good = { type: 'video/mp4', size: 100, duration: 10, h264: true }
    expect(isVideoFastPath(good)).toBe(true)
    for (const change of [{ h264: false }, { duration: 21 }, { size: MAX_VIDEO_BYTES + 1 }, { type: 'video/quicktime' }]) expect(isVideoFastPath({ ...good, ...change })).toBe(false)
  })
  it('rejects arbitrary data as fast-start H264', async () => {
    expect(await inspectMp4(new Blob(['not an mp4']))).toEqual({ h264: false, fastStart: false })
  })
})
