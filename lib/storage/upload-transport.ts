export { putWithRetry as putImage, waitUntilOnline, UploadError as ImageUploadError } from './put'

export function uploadConcurrency(): number {
  if (typeof navigator === 'undefined') return 3
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection
  if (!connection) return 3
  if (connection.saveData || /(^|-)2g$/.test(connection.effectiveType ?? '')) return 1
  return connection.effectiveType === '3g' ? 2 : 4
}
