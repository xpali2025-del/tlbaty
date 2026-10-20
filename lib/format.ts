export function formatPrice(minor: number, currency: string) {
  return new Intl.NumberFormat('ar-SA', { style: 'currency', currency }).format(minor / 100)
}
