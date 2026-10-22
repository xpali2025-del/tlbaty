import { describe, expect, it } from 'vitest'
import { COMMON_SIZE_CHARTS, parseSizeChart, recommendSize, validateSizeChart, type SizeChart } from '@/lib/size-chart'

const women = COMMON_SIZE_CHARTS.find((c) => c.name === 'ملابس نسائية')!
const shoes = COMMON_SIZE_CHARTS.find((c) => c.name === 'أحذية')!

describe('common charts', () => {
  it('are all valid, in centimetres, with unique sizes', () => {
    for (const chart of COMMON_SIZE_CHARTS) expect(validateSizeChart(chart), chart.name).toBeNull()
    expect(COMMON_SIZE_CHARTS.map((c) => c.name)).toEqual(['ملابس نسائية', 'ملابس رجالية', 'ملابس أطفال', 'أحذية'])
  })
})

describe('validateSizeChart', () => {
  const base = (): SizeChart => JSON.parse(JSON.stringify(women))
  it('rejects broken charts with a clear reason', () => {
    const c1 = base(); c1.name = ' '
    expect(validateSizeChart(c1)).toContain('اسم الجدول')
    const c2 = base(); c2.columns.push({ key: 'chest', label: 'تكرار' })
    expect(validateSizeChart(c2)).toContain('مكرر')
    const c3 = base(); c3.rows[1].size = 'XS'
    expect(validateSizeChart(c3)).toContain('مكرر')
    const c4 = base(); c4.rows[0].ranges.chest = [90, 80]
    expect(validateSizeChart(c4)).toContain('غير صالح')
    const c5 = base(); c5.rows[0].ranges.chest = [1, 2]
    expect(validateSizeChart(c5)).toContain('غير صالح')
    const c6 = base(); delete c6.rows[0].ranges.waist
    expect(validateSizeChart(c6)).toContain('أدخل مدى')
    const c7 = base(); c7.rows = []
    expect(validateSizeChart(c7)).toContain('عدد المقاسات')
    const c8 = base(); c8.columns[0].key = 'Bad Key'
    expect(validateSizeChart(c8)).toContain('مفتاح')
  })
})

describe('parseSizeChart', () => {
  it('cleans a well-formed value and rejects other shapes', () => {
    expect(parseSizeChart({ name: ' س ', columns: [{ key: 'a', label: ' ب ' }], rows: [{ size: ' M ', ranges: { a: ['10', 20] } }] })).toEqual({
      name: 'س', columns: [{ key: 'a', label: 'ب' }], rows: [{ size: 'M', ranges: { a: [10, 20] } }],
    })
    for (const bad of [null, 'x', {}, { name: 'x', columns: 'no', rows: [] }, { name: 'x', columns: [{ key: 1 }], rows: [] }, { name: 'x', columns: [], rows: [{ size: 'M', ranges: { a: [1] } }] }]) {
      expect(parseSizeChart(bad)).toBeNull()
    }
  })
})

describe('recommendSize', () => {
  it('picks the size whose ranges contain the measurements', () => {
    expect(recommendSize(women, { chest: 90, waist: 72, hip: 98 })).toEqual({ size: 'M', alternate: null, exact: true })
    expect(recommendSize(women, { chest: 101 })).toMatchObject({ size: 'XL', exact: true })
  })
  it('uses whatever measurements were given and ignores the rest', () => {
    expect(recommendSize(women, { waist: 62 })).toMatchObject({ size: 'XS' })
    expect(recommendSize(women, { chest: undefined, waist: 0 })).toBeNull()
    expect(recommendSize(women, {})).toBeNull()
  })
  it('picks the nearest size outside every range and says it is not exact', () => {
    expect(recommendSize(women, { chest: 70 })).toMatchObject({ size: 'XS', exact: false })
    expect(recommendSize(women, { chest: 140 })).toMatchObject({ size: 'XXL', exact: false })
  })
  it('flags a customer who is between two sizes', () => {
    // chest fits M, waist fits L: both sizes are equally far
    const r = recommendSize(women, { chest: 90, waist: 77 })
    expect(r?.alternate).not.toBeNull()
    // a gap between sizes: 87.5 chest is between S (83-87) and M (88-92)
    expect(recommendSize(women, { chest: 87.5 })).toMatchObject({ size: 'M', alternate: 'S' })
  })
  it('works for shoes from the foot length', () => {
    expect(recommendSize(shoes, { foot: 25.3 })).toMatchObject({ size: '40', exact: true })
    expect(recommendSize(shoes, { foot: 26.0 })).toMatchObject({ size: '41', alternate: null, exact: true })
    // 26.35 falls in the 0.1 cm gap between 41 and 42: larger one first, the other as alternate
    expect(recommendSize(shoes, { foot: 26.35 })).toMatchObject({ size: '42', alternate: '41' })
  })
})
