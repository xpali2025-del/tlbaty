import { describe, expect, it } from 'vitest'
import {
  AD_PLACEMENTS,
  adAllowedAt,
  adsForPlacement,
  createAdPicker,
  isAdLive,
  normalizePlacements,
  parseDateOnly,
  todayInAden,
  validateVideoFile,
} from '@/lib/ads'
import { isValidVideoKey } from '@/lib/storage/keys'
import { uploadAdVideo } from '@/lib/storage/video-client'

describe('placements', () => {
  it('normalizes to known, unique, stable-ordered keys; all selected means everywhere', () => {
    expect(normalizePlacements(['grid', 'x', 'home_new', 'grid'])).toEqual(['home_new', 'grid'])
    expect(normalizePlacements('nope')).toEqual([])
    expect(normalizePlacements(AD_PLACEMENTS.map((p) => p.key))).toEqual([])
  })

  it('treats empty placements as everywhere and filters otherwise', () => {
    expect(adAllowedAt({}, 'grid')).toBe(true)
    expect(adAllowedAt({ placements: [] }, 'category')).toBe(true)
    expect(adAllowedAt({ placements: ['grid'] }, 'category')).toBe(false)
    expect(adsForPlacement([{ placements: ['grid'] }, {}], 'category')).toHaveLength(1)
  })

  it('picks the least-shown eligible ad per slot and rotates', () => {
    const pick = createAdPicker([
      { id: 'a', placements: ['home_new'] },
      { id: 'b', placements: [] },
    ])
    expect(pick('home_new')?.id).toBe('a')
    expect(pick('home_offers')?.id).toBe('b')
    expect(pick('home_new')?.id).toBe('a') // a=1,b=1 → أول المتعادلين
    expect(pick('home_new')?.id).toBe('b')
    expect(createAdPicker([{ id: 'c', placements: ['grid'] }])('home_new')).toBeNull()
  })
})

describe('date window', () => {
  it('parses strict YYYY-MM-DD only', () => {
    expect(parseDateOnly('2026-05-01')).toBe('2026-05-01')
    for (const bad of ['2026-5-1', '2026-02-30', '', null, 5, '2026-05-01T00:00']) expect(parseDateOnly(bad)).toBeNull()
  })

  it('is inclusive on both ends and open when missing', () => {
    const ad = { startsOn: '2026-05-10', endsOn: '2026-05-12' }
    expect(isAdLive(ad, '2026-05-09')).toBe(false)
    expect(isAdLive(ad, '2026-05-10')).toBe(true)
    expect(isAdLive(ad, '2026-05-12')).toBe(true)
    expect(isAdLive(ad, '2026-05-13')).toBe(false)
    expect(isAdLive({}, '2030-01-01')).toBe(true)
    expect(isAdLive({ endsOn: '2026-05-12' }, '2020-01-01')).toBe(true)
  })

  it('computes today in Aden time (UTC+3)', () => {
    expect(todayInAden(new Date('2026-05-10T20:59:00Z'))).toBe('2026-05-10')
    expect(todayInAden(new Date('2026-05-10T21:00:00Z'))).toBe('2026-05-11')
  })
})

describe('video limits', () => {
  it('validates type, size and duration with Arabic messages', () => {
    expect(validateVideoFile({ type: 'video/mp4', size: 1000, duration: 10 })).toBeNull()
    expect(validateVideoFile({ type: 'video/webm', size: 1000 })).toContain('MP4')
    expect(validateVideoFile({ type: 'video/mp4', size: 0 })).toContain('فارغ')
    expect(validateVideoFile({ type: 'video/mp4', size: 9 * 1024 * 1024 })).toContain('8')
    expect(validateVideoFile({ type: 'video/mp4', size: 1000, duration: 21 })).toContain('20')
    expect(validateVideoFile({ type: 'video/mp4', size: 1000, duration: NaN })).toContain('مدة')
  })

  it('accepts only ads/*.mp4 video keys', () => {
    expect(isValidVideoKey('ads/abc-1.mp4')).toBe(true)
    for (const bad of ['ads/a.webp', 'products/a.mp4', 'ads/../a.mp4', 'ads/a/b.mp4', 'https://x/a.mp4']) expect(isValidVideoKey(bad)).toBe(false)
  })

  it('uploads a valid video and rejects invalid ones before requesting a URL', async () => {
    const puts: string[] = []
    const deps = {
      inspect: async () => ({ duration: 10, width: 1200, height: 600 }),
      request: async (type: string, size: number) => ({ uploadUrl: `u/${type}/${size}`, objectKey: 'ads/k.mp4' }),
      put: async (url: string) => void puts.push(url),
    }
    const file = new File([new Uint8Array(100)], 'a.mp4', { type: 'video/mp4' })
    expect(await uploadAdVideo(file, deps)).toBe('ads/k.mp4')
    expect(puts).toEqual(['u/video/mp4/100'])
    await expect(uploadAdVideo(file, { ...deps, inspect: async () => ({ duration: 30, width: 1, height: 1 }) })).rejects.toThrow('20')
    await expect(uploadAdVideo(new File([new Uint8Array(1)], 'a.mov', { type: 'video/quicktime' }), deps)).rejects.toThrow('MP4')
    expect(puts).toHaveLength(1)
  })
})
