import { describe, expect, it } from 'vitest'
import { classifyDbError } from '@/lib/db-error'

const wrapped = (code: string | undefined, message = 'x') => Object.assign(new Error('Failed query'), { cause: Object.assign(new Error(message), { code }) })

describe('classifyDbError', () => {
  it.each(['42703', '42P01', '3F000', '42704'])('treats postgres %s (missing column/table/schema/type) as an unapplied migration', (code) => {
    expect(classifyDbError(wrapped(code))).toBe('migration')
  })
  it('detects permission and connection problems through the cause chain', () => {
    expect(classifyDbError(wrapped('42501'))).toBe('permission')
    expect(classifyDbError(wrapped('28P01', 'password authentication failed'))).toBe('connection')
    expect(classifyDbError(wrapped(undefined, 'connect ECONNREFUSED 127.0.0.1:5432'))).toBe('connection')
    expect(classifyDbError(new Error('DATABASE_URL is required'))).toBe('connection')
  })
  it('falls back to unknown without throwing on odd values', () => {
    expect(classifyDbError(new Error('boom'))).toBe('unknown')
    expect(classifyDbError(null)).toBe('unknown')
    expect(classifyDbError('str')).toBe('unknown')
  })
})
