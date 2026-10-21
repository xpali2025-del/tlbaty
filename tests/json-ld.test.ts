import { describe, expect, it } from 'vitest'
import { safeJsonLd } from '@/lib/json-ld'

describe('safeJsonLd', () => {
  it('cannot break out of the script tag and round-trips through JSON.parse', () => {
    const evil = { name: '</script><script>alert(1)</script>', d: 'a & b <b>', sep: 'x y z' }
    const out = safeJsonLd(evil)
    expect(out).not.toContain('<')
    expect(out).not.toContain('>')
    expect(out).not.toContain(' ')
    expect(JSON.parse(out)).toEqual(evil)
  })
})
