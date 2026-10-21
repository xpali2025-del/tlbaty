import { describe, expect, it } from 'vitest'
import { buildSearchText, normalizeSearchText, searchTokens } from '@/lib/search-text'
import { colorDistance, extractPalette, paletteSimilarity, sanitizePalette, type PaletteColor } from '@/lib/palette'

describe('normalizeSearchText', () => {
  it('unifies arabic letter variants, diacritics, digits and case', () => {
    expect(normalizeSearchText('فُسْتَانٌ')).toBe(normalizeSearchText('فستان'))
    expect(normalizeSearchText('أحمر إلى آخره')).toBe('احمر الي اخره')
    expect(normalizeSearchText('مدرسة')).toBe(normalizeSearchText('مدرسه'))
    expect(normalizeSearchText('NIKE Air-Max ١٢٣')).toBe('nike air max 123')
    expect(normalizeSearchText('  a   b ')).toBe('a b')
  })
  it('tokenizes without duplicates and drops one-letter noise', () => {
    expect(searchTokens('فستان  فستان أحمر و')).toEqual(['فستان', 'احمر'])
    expect(searchTokens('')).toEqual([])
    expect(searchTokens('a b c d e f g h i j k l m n o p').length).toBeLessThanOrEqual(8)
  })
  it('builds one normalized search text from every searchable field', () => {
    const t = buildSearchText({ name: 'فستان سهرة', code: 'DR-012', sku: 'SKU9', category: 'نساء', brand: 'Nike', colors: ['أحمر'], tags: ['new'], description: 'قماش ناعم' })
    for (const w of ['فستان', 'dr 012', 'sku9', 'نساء', 'nike', 'احمر', 'new', 'قماش']) expect(t).toContain(w)
  })
})

const px = (rgb: [number, number, number], n: number) => Array.from({ length: n }, () => [...rgb, 255]).flat()

describe('palette', () => {
  it('ignores a white background and keeps the product colors with weights', () => {
    const pixels = [...px([255, 255, 255], 700), ...px([200, 30, 40], 200), ...px([20, 20, 120], 100)]
    const palette = extractPalette(pixels)
    expect(palette).toHaveLength(2)
    expect(palette[0].weight).toBeCloseTo(0.667, 2)
    expect(colorDistance(palette[0].hex, '#c81e28')).toBeLessThan(6)
    expect(colorDistance(palette[1].hex, '#141478')).toBeLessThan(6)
  })
  it('keeps a white product when nothing else is in the image, and ignores transparency', () => {
    expect(extractPalette(px([250, 250, 250], 100))[0].hex).toBe('#fafafa')
    expect(extractPalette([10, 10, 10, 0, 10, 10, 10, 0])).toEqual([])
  })
  it('merges near shades into one color', () => {
    const pixels = [...px([200, 30, 40], 100), ...px([205, 35, 45], 100)]
    expect(extractPalette(pixels)).toHaveLength(1)
  })
  const red: PaletteColor[] = [{ hex: '#c81e28', weight: 1 }]
  it('ranks similar colors above different ones and is symmetric-ish', () => {
    const similar = paletteSimilarity(red, [{ hex: '#d02530', weight: 1 }])
    const other = paletteSimilarity(red, [{ hex: '#1e28c8', weight: 1 }])
    expect(similar).toBeGreaterThan(0.8)
    expect(other).toBeLessThan(0.1)
    expect(paletteSimilarity(red, [])).toBe(0)
    // a half-blue product is a worse match for a plain red photo than a red one
    expect(paletteSimilarity(red, [{ hex: '#d02530', weight: 0.5 }, { hex: '#1e28c8', weight: 0.5 }])).toBeLessThan(similar)
  })
  it('sanitizes palettes coming from a browser', () => {
    expect(sanitizePalette([{ hex: '#FF0000', weight: 2 }, { hex: 'red', weight: 1 }, { hex: '#00ff00', weight: -1 }, null, { hex: '#0000FF', weight: 2 }])).toEqual([
      { hex: '#ff0000', weight: 0.5 },
      { hex: '#0000ff', weight: 0.5 },
    ])
    expect(sanitizePalette('x')).toEqual([])
    expect(sanitizePalette(Array.from({ length: 50 }, () => ({ hex: '#ffffff', weight: 1 }))).length).toBeLessThanOrEqual(4)
  })
})
