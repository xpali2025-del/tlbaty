import { describe, expect, it } from 'vitest'
import { safeInternalPath } from '@/lib/safe-redirect'

describe('safeInternalPath', () => {
  it('keeps internal paths with query and hash', () => {
    expect(safeInternalPath('/orders')).toBe('/orders')
    expect(safeInternalPath('/checkout?x=1#a')).toBe('/checkout?x=1#a')
  })
  it('rejects anything a browser could read as another origin', () => {
    for (const bad of ['//evil.com', '/\\evil.com', '/\\/evil.com', '\\\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/\tevil.com', '/\n/evil.com', 'evil.com', '', undefined, null, 42, '/' + 'a'.repeat(3000)]) {
      expect(safeInternalPath(bad), String(bad)).toBe('/')
    }
    expect(safeInternalPath('//evil.com', '/account')).toBe('/account')
  })
})
