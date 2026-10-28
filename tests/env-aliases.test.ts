import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDbConfigured } from '@/lib/db-cache'
import { getNotificationsConfigReport } from '@/lib/admin-notifications'
import { resolveImageUrl } from '@/lib/images'

// المشروع يقبل أسماء بديلة بلاحقة _2 (lib/env.ts). كل فحص للإعداد يجب أن يحترمها، وإلا ظهرت
// «مشروع الإشعارات غير مهيأ» واختفت الأكواد الشخصية والبحث بالصورة والصور رغم أن الإعداد صحيح.
afterEach(() => vi.unstubAllEnvs())

describe('environment aliases (_2)', () => {
  it('treats DATABASE_URL_2 alone as a configured database', () => {
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('DATABASE_URL_2', 'postgres://u:p@db.example.com:6543/postgres')
    expect(isDbConfigured()).toBe(true)
    expect(getNotificationsConfigReport()).toEqual({ ready: true, readReady: true, missing: [] })
  })

  it('reports the missing variable when neither name is set', () => {
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('DATABASE_URL_2', '')
    expect(getNotificationsConfigReport().ready).toBe(false)
  })

  it('builds image URLs from R2_PUBLIC_URL_2 when only the alias is set', () => {
    vi.stubEnv('R2_PUBLIC_URL', '')
    vi.stubEnv('R2_PUBLIC_URL_2', 'https://cdn.example.com/')
    expect(resolveImageUrl('products/a.webp')).toBe('https://cdn.example.com/products/a.webp')
  })
})
