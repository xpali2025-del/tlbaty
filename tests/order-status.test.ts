import { describe, expect, it } from 'vitest'
import { customerStageOf, holdsStockAndPayment, isOpenOrderStatus } from '@/lib/order-status'

describe('customer-facing order stage', () => {
  it('shows "assigned" as the "ready" stage and leaves other statuses as they are', () => {
    expect(customerStageOf('assigned')).toBe('ready')
    for (const s of ['new', 'confirmed', 'processing', 'ready', 'on_the_way', 'delivered', 'failed', 'cancelled', 'returned'] as const) expect(customerStageOf(s)).toBe(s)
  })
})

describe('holdsStockAndPayment vs isOpenOrderStatus', () => {
  it('keeps "failed" holding stock and payment (it is not final), unlike the open check', () => {
    expect(holdsStockAndPayment('failed')).toBe(true)
    expect(isOpenOrderStatus('failed')).toBe(false)
    for (const s of ['delivered', 'cancelled', 'returned'] as const) expect(holdsStockAndPayment(s)).toBe(false)
    for (const s of ['new', 'confirmed', 'processing', 'ready', 'assigned', 'on_the_way'] as const) expect(holdsStockAndPayment(s)).toBe(true)
  })
})
