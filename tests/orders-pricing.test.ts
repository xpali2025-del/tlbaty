import { describe, expect, it } from 'vitest'
import { computeOrderPricing, couponDiscountBase, priceChanged, type PricingInput } from '@/lib/orders/pricing'
import { FALLBACK_SHIPPING_METHODS, isPickupMethod, resolveShippingMethods } from '@/lib/shipping'
import type { Coupon, ShippingZone } from '@/lib/types'

const YER = { code: 'YER', name: 'ريال', symbol: 'ر.ي', rate: 1 }
const USD = { code: 'USD', name: 'دولار', symbol: '$', rate: 500 }
const zones: ShippingZone[] = [
  { id: 'd', governorate: '', isDefault: true, methods: [{ id: 'm1', name: 'عادي', desc: '', price: 700, icon: 'standard' }] },
  { id: 's', governorate: 'صنعاء', isDefault: false, methods: [{ id: 'm2', name: 'سريع', desc: '', price: 1500, icon: 'express' }, { id: 'm3', name: 'استلام', desc: '', price: 0, icon: 'pickup' }] },
]
const coupons: Coupon[] = [
  { code: 'TEN', discount: 10, type: 'percent', minOrder: 5000, description: '' },
  { code: 'FLAT', discount: 2000, type: 'fixed', minOrder: 0, description: '' },
  { code: 'HUGE', discount: 999999, type: 'fixed', minOrder: 0, description: '' },
]
const products = new Map([
  ['p1', { id: 'p1', name: 'قميص', price: 4000, sku: 'S1', image: '/a.jpg' }],
  ['p2', { id: 'p2', name: 'حقيبة', price: 12500, sku: 'S2', image: '/b.jpg' }],
])
const base = (over: Partial<PricingInput> = {}): PricingInput => ({
  items: [{ productId: 'p1', size: 'M', color: 'أحمر', quantity: 2 }],
  products, zones, city: 'صنعاء', shippingMethodName: 'سريع', coupons, couponCode: '',
  currencies: [YER, USD], defaultCurrencyCode: 'YER', currencyCode: 'YER', ...over,
})
const ok = (r: ReturnType<typeof computeOrderPricing>) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`)
  return r
}

describe('computeOrderPricing', () => {
  it('prices from the database product, never from the client', () => {
    const r = ok(computeOrderPricing(base()))
    expect(r.lines).toEqual([{ productId: 'p1', name: 'قميص', sku: 'S1', image: '/a.jpg', size: 'M', color: 'أحمر', quantity: 2, price: 4000, lineTotal: 8000 }])
    expect(r.base).toEqual({ subtotal: 8000, shipping: 1500, discount: 0, total: 9500 })
    expect([r.subtotal, r.shippingPrice, r.discount, r.total]).toEqual([8000, 1500, 0, 9500])
  })

  it('converts every number to the chosen currency exactly like the storefront (round each separately)', () => {
    const r = ok(computeOrderPricing(base({ currencyCode: 'USD', items: [{ productId: 'p2', size: '', color: '', quantity: 3 }], couponCode: 'FLAT' })))
    // base: subtotal 37500, shipping 1500, discount 2000, total 37000 ; rate 500
    expect(r.base).toEqual({ subtotal: 37500, shipping: 1500, discount: 2000, total: 37000 })
    expect(r.lines[0]).toMatchObject({ price: 25, lineTotal: 75 })
    expect([r.subtotal, r.shippingPrice, r.discount, r.total]).toEqual([75, 3, 4, 74])
    expect(r.currency.code).toBe('USD')
  })

  it('falls back to the default currency for unknown codes, then to the first currency', () => {
    expect(ok(computeOrderPricing(base({ currencyCode: 'XXX' }))).currency.code).toBe('YER')
    expect(ok(computeOrderPricing(base({ currencyCode: 'XXX', defaultCurrencyCode: 'ZZZ' }))).currency.code).toBe('YER')
  })

  it('resolves shipping by governorate, then the default zone, then the built-in fallback', () => {
    expect(ok(computeOrderPricing(base({ city: 'صنعاء', shippingMethodName: 'استلام' }))).base.shipping).toBe(0)
    expect(ok(computeOrderPricing(base({ city: 'تعز', shippingMethodName: 'عادي' }))).base.shipping).toBe(700)
    expect(ok(computeOrderPricing(base({ city: 'أي مكان', zones: [], shippingMethodName: 'شحن سريع' }))).base.shipping).toBe(1000)
    expect(resolveShippingMethods([], 'صنعاء')).toBe(FALLBACK_SHIPPING_METHODS)
    // Arabic normalisation (alef/ya/ta marbuta variants) matches the zone like the storefront does.
    expect(resolveShippingMethods(zones, 'صنعاء ').map((m) => m.name)).toEqual(['سريع', 'استلام'])
  })

  it('rejects a shipping method that is not offered for that city', () => {
    expect(computeOrderPricing(base({ city: 'تعز', shippingMethodName: 'سريع' }))).toEqual({ ok: false, error: 'INVALID_SHIPPING_METHOD' })
    expect(computeOrderPricing(base({ shippingMethodName: '' }))).toEqual({ ok: false, error: 'INVALID_SHIPPING_METHOD' })
  })

  it('rejects unknown products and invalid quantities', () => {
    expect(computeOrderPricing(base({ items: [{ productId: 'nope', size: '', color: '', quantity: 1 }] }))).toEqual({ ok: false, error: 'UNKNOWN_PRODUCT', productId: 'nope' })
    for (const quantity of [0, -1, 1.5, 1000, Number.NaN]) {
      expect(computeOrderPricing(base({ items: [{ productId: 'p1', size: '', color: '', quantity }] }))).toMatchObject({ ok: false, error: 'INVALID_QUANTITY' })
    }
  })

  it('applies coupons on the base subtotal and never lets the total go negative', () => {
    expect(ok(computeOrderPricing(base({ couponCode: 'flat' }))).base).toMatchObject({ discount: 2000, total: 7500 })
    expect(ok(computeOrderPricing(base({ couponCode: 'TEN', items: [{ productId: 'p2', size: '', color: '', quantity: 1 }] }))).base).toMatchObject({ discount: 1250, total: 12750 })
    expect(ok(computeOrderPricing(base({ couponCode: 'HUGE' }))).base.total).toBe(0)
  })

  it('ignores coupons that are unknown or below the minimum order', () => {
    const below = ok(computeOrderPricing(base({ couponCode: 'TEN' }))) // 8000 >= 5000 → valid
    expect(below.couponCode).toBe('TEN')
    const tiny = new Map([['t', { id: 't', name: 'x', price: 1000 }]])
    const r = ok(computeOrderPricing(base({ products: tiny, items: [{ productId: 't', size: '', color: '', quantity: 1 }], couponCode: 'TEN' })))
    expect(r.couponCode).toBe('')
    expect(r.discount).toBe(0)
    expect(ok(computeOrderPricing(base({ couponCode: 'NOPE' }))).couponCode).toBe('')
  })
})

describe('couponDiscountBase and priceChanged', () => {
  it('computes coupon amounts', () => {
    expect(couponDiscountBase(coupons, ' ten ', 10000)).toEqual({ code: 'TEN', amount: 1000 })
    expect(couponDiscountBase(coupons, '', 10000)).toEqual({ code: '', amount: 0 })
    expect(couponDiscountBase(coupons, 'TEN', 4999)).toEqual({ code: '', amount: 0 })
  })

  it('flags a difference beyond rounding tolerance and ignores one unit of rounding', () => {
    const server = { total: 100, subtotal: 90, shippingPrice: 10, discount: 0 }
    expect(priceChanged(server, { ...server })).toBe(false)
    expect(priceChanged(server, { ...server, total: 101 })).toBe(false)
    expect(priceChanged(server, { ...server, total: 102 })).toBe(true)
    expect(priceChanged(server, { total: 1, subtotal: 1, shippingPrice: 0, discount: 0 })).toBe(true)
  })
})

describe('isPickupMethod', () => {
  it('is true only for the pickup icon', () => {
    expect(isPickupMethod({ icon: 'pickup' })).toBe(true)
    expect(isPickupMethod({ icon: 'express' })).toBe(false)
    expect(isPickupMethod({ icon: 'standard' })).toBe(false)
    expect(isPickupMethod(null)).toBe(false)
    expect(isPickupMethod(undefined)).toBe(false)
  })
  it('is flagged by the server pricing by method, not by name', () => {
    expect(ok(computeOrderPricing(base({ shippingMethodName: 'استلام' }))).pickup).toBe(true)
    expect(ok(computeOrderPricing(base({ shippingMethodName: 'سريع' }))).pickup).toBe(false)
    expect(FALLBACK_SHIPPING_METHODS.filter(isPickupMethod).map((m) => m.name)).toEqual(['استلام من المتجر'])
  })
})
