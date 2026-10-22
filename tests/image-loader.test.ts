import { describe, expect, it } from 'vitest'
import loader from '@/lib/image-loader'

describe('image loader (Cloudflare Image Resizing)', () => {
  it('rewrites public R2 image urls with width, quality and auto format', () => {
    expect(loader({ src: 'https://cdn.example.com/products/abc-1.jpg', width: 640, quality: 80 })).toBe(
      'https://cdn.example.com/cdn-cgi/image/width=640,quality=80,format=auto,fit=scale-down/products/abc-1.jpg',
    )
    expect(loader({ src: 'https://cdn.example.com/slides/s.webp', width: 1080 })).toContain('width=1080,quality=75')
  })
  it('leaves local files, unknown folders and non-http urls alone', () => {
    expect(loader({ src: '/images/product-placeholder.webp', width: 640 })).toBe('/images/product-placeholder.webp')
    expect(loader({ src: 'https://cdn.example.com/payment-proofs/x.enc', width: 640 })).toBe('https://cdn.example.com/payment-proofs/x.enc')
    expect(loader({ src: 'data:image/png;base64,AAA', width: 64 })).toBe('data:image/png;base64,AAA')
  })
})
