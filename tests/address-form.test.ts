import { describe, expect, it } from 'vitest'
import { isPresetLabel, normalizeAddressLabel, validateAddressName, validateAddressPhone } from '@/lib/address-form'
import { ADDRESS_LABELS, MAX_ADDRESS_LABEL, MAX_SAVED_ADDRESSES } from '@/hooks/use-saved-addresses'

describe('address form validation', () => {
  it('requires a three-word name and a nine-digit phone, like checkout', () => {
    expect(validateAddressName('علي محمد')).not.toBe('')
    expect(validateAddressName('علي محمد أحمد')).toBe('')
    expect(validateAddressName('  علي   محمد   أحمد  ')).toBe('')
    expect(validateAddressPhone('78159585')).not.toBe('')
    expect(validateAddressPhone('781595851')).toBe('')
    expect(validateAddressPhone('781 595 851')).toBe('')
  })
  it('normalizes labels: trimmed, one space, capped, empty means none', () => {
    expect(normalizeAddressLabel('  بيت   العائلة ')).toBe('بيت العائلة')
    expect(normalizeAddressLabel('   ')).toBeUndefined()
    expect(normalizeAddressLabel(5)).toBeUndefined()
    expect(normalizeAddressLabel('x'.repeat(100))).toHaveLength(MAX_ADDRESS_LABEL)
  })
  it('knows the preset labels ("أخرى" is a custom-name placeholder, not a preset)', () => {
    expect(ADDRESS_LABELS).toEqual(['المنزل', 'العمل', 'أخرى'])
    expect(isPresetLabel('المنزل')).toBe(true)
    expect(isPresetLabel('العمل')).toBe(true)
    expect(isPresetLabel('أخرى')).toBe(false)
    expect(isPresetLabel('بيت العائلة')).toBe(false)
    expect(isPresetLabel(undefined)).toBe(false)
  })
  it('keeps the address cap at the server limit so sync never rejects a full list', () => {
    expect(MAX_SAVED_ADDRESSES).toBe(20)
  })
})
