import { redirect } from 'next/navigation'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { isActionFailure, unwrapAction, unwrapAll } from '@/lib/action-result'
import { actionErrorMessage, serverAction } from '@/lib/server-action'

describe('serverAction (errors as values so production shows the message)', () => {
  it('returns the result unchanged on success', async () => {
    expect(await serverAction(async (a: number, b: number) => a + b)(2, 3)).toBe(5)
  })

  it('passes Arabic user-facing messages through as a failure value', async () => {
    const r = await serverAction(async () => { throw new Error('اسم المنتج مطلوب') })()
    expect(r).toEqual({ __actionError: 'اسم المنتج مطلوب' })
    expect(isActionFailure(r)).toBe(true)
  })

  it('hides technical errors behind a generic message and logs them', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await serverAction(async () => { throw new Error('Failed query: select * from secret_table') })()
    expect(isActionFailure(r) && r.__actionError).not.toContain('secret_table')
    expect(isActionFailure(r) && r.__actionError).toContain('تعذّر تنفيذ العملية')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('uses the first Zod issue message', () => {
    const parsed = z.object({ amount: z.number().positive('المبلغ يجب أن يكون موجباً') }).safeParse({ amount: -1 })
    expect(actionErrorMessage(parsed.error)).toBe('المبلغ يجب أن يكون موجباً')
  })

  it('rethrows Next control-flow errors such as redirect()', async () => {
    await expect(serverAction(async () => redirect('/manage/login'))()).rejects.toThrow('NEXT_REDIRECT')
  })
})

describe('unwrapAction / unwrapAll (client side)', () => {
  it('throws the server message on failure and returns values otherwise', async () => {
    expect(() => unwrapAction({ __actionError: 'الطلب غير موجود' })).toThrow('الطلب غير موجود')
    expect(unwrapAction({ ok: false, error: 'x' })).toEqual({ ok: false, error: 'x' })
    const mod = unwrapAll({
      good: async () => 'slug',
      bad: async () => ({ __actionError: 'رفض' }) as const,
      constant: 1,
    })
    expect(await mod.good()).toBe('slug')
    await expect(mod.bad()).rejects.toThrow('رفض')
    expect(mod.constant).toBe(1)
  })
})
