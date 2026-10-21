import { describe, expect, it } from 'vitest'
import { maskPhone, normalizeInternationalPhone } from '@/lib/phone'
import { toInternationalPhone } from '../worker/whatsapp/inbound.mjs'

describe('normalizeInternationalPhone', () => {
  it.each([
    ['781234567', '967781234567'],
    ['0781234567', '967781234567'],
    ['+967 78 123 4567', '967781234567'],
    ['00967781234567', '967781234567'],
    ['967781234567', '967781234567'],
    ['٧٨١٢٣٤٥٦٧', '967781234567'], // Arabic-Indic digits
    ['۰۷۸۱۲۳۴۵۶۷', '967781234567'], // Persian digits
    ['512345678', '966512345678'],
    ['0512345678', '966512345678'],
    ['+966 51 234 5678', '966512345678'],
    ['00966512345678', '966512345678'],
    [966512345678, '966512345678'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeInternationalPhone(input)).toBe(expected)
  })

  it.each([
    '', '123', 'abc', null, undefined, {},
    '971501234567', // UAE
    '967512345678', // Yemeni number must start with 7
    '966712345678', // Saudi mobile must start with 5
    '78123456', // too short
    '7812345678', // too long
    '9677812345678', // too long with country code
    '0112345678', // landline-style
  ])('rejects %j', (input) => {
    expect(normalizeInternationalPhone(input)).toBeNull()
  })

  it('is idempotent', () => {
    for (const p of ['0781234567', '+966 51 234 5678']) {
      const once = normalizeInternationalPhone(p)!
      expect(normalizeInternationalPhone(once)).toBe(once)
    }
  })
})

describe('maskPhone', () => {
  it('keeps the country code and the first and last two national digits', () => {
    expect(maskPhone('967781234567')).toBe('+967 78•••••67')
    expect(maskPhone('966512345678')).toBe('+966 51•••••78')
  })
})

describe('app and worker agree on which numbers are valid', () => {
  it.each([
    '967781234567', '966512345678', '967512345678', '966712345678', '971501234567',
    '96778123456', '9677812345678', '781234567', '', '966 51 234 5678',
  ])('both give the same answer for %j', (input) => {
    const app = normalizeInternationalPhone(input)
    const worker = toInternationalPhone(input)
    // The worker only sees full international numbers (WhatsApp contact ids); for those the rules must match.
    if (/^\d{11,}$/.test(input.replace(/\D/g, '')) && (app ?? worker)) expect(worker).toBe(app)
    if (!input.replace(/\D/g, '').match(/^(967|966)/)) expect(worker).toBeNull()
  })
})

import { normalizeSenderPhone } from '@/lib/phone'
describe('normalizeSenderPhone', () => {
  it('unifies yemeni/saudi numbers to international digits and accepts other wallets', () => {
    expect(normalizeSenderPhone('0771234567')).toBe('967771234567')
    expect(normalizeSenderPhone('771234567')).toBe('967771234567')
    expect(normalizeSenderPhone('+967 77-123-4567')).toBe('967771234567')
    expect(normalizeSenderPhone('٠٧٧١٢٣٤٥٦٧')).toBe('967771234567')
    expect(normalizeSenderPhone('0501234567')).toBe('966501234567')
    expect(normalizeSenderPhone('+44 7700 900123')).toBe('447700900123')
  })
  it('rejects empty, short, long, lettered and non-string input', () => {
    for (const bad of ['', '   ', '123', '12ab34567', '1'.repeat(16), null, undefined, 5, '++9677712']) expect(normalizeSenderPhone(bad)).toBeNull()
  })
})
