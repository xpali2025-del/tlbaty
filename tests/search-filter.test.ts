import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))
const { toggleMulti, priceStep, EMPTY_DRAFT } = await import('@/components/search-filter-sheet')

const ALL = ['a', 'b', 'c']

describe('toggleMulti ("select all" or specific items)', () => {
  it('unchecking one while everything is selected keeps the others', () => {
    expect(toggleMulti(undefined, ALL, 'b')).toEqual(['a', 'c'])
    expect(toggleMulti([], ALL, 'a')).toEqual(['b', 'c'])
  })
  it('re-checking brings it back, and a full selection collapses to "all" (no fake filter in the URL)', () => {
    expect(toggleMulti(['a', 'c'], ALL, 'b')).toBeUndefined()
    expect(toggleMulti(['a'], ALL, 'b')).toEqual(['a', 'b'])
  })
  it('removing the last selected item falls back to "all" instead of an empty (match-nothing) filter', () => {
    expect(toggleMulti(['a'], ALL, 'a')).toBeUndefined()
  })
  it('keeps the order of the source list', () => {
    expect(toggleMulti(['c'], ALL, 'a')).toEqual(['a', 'c'])
  })
})

describe('priceStep', () => {
  it('gives 1 for small ranges and grows by powers of ten', () => {
    expect(priceStep(0, 40)).toBe(1)
    expect(priceStep(100, 600)).toBe(10)
    expect(priceStep(0, 50_000)).toBe(1000)
    expect(priceStep(5, 5)).toBe(1)
  })
})

it('the empty draft clears every filter field', () => {
  expect(Object.values(EMPTY_DRAFT).every((v) => v === undefined)).toBe(true)
})
