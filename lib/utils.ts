import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * يفكّ ترميز سلاج المسار الديناميكي القادم من `params`.
 *
 * في Next.js 16 (Turbopack) تصل السلاجات التي تحتوي حروفاً غير لاتينية
 * (مثل العربية) بصيغة مُرمّزة "%D8%B9…" بدل فكّها، فيفشل مطابقتها مع
 * السلاج المخزّن في قاعدة البيانات ("عطور") وتظهر صفحة 404.
 *
 * هذه الدالة تفكّ الترميز بأمان (تتجاهل السلاجات اللاتينية دون تغيير،
 * ولا ترمي خطأً عند وجود "%" مفردة غير صالحة).
 */
export function decodeSlug(slug: string): string {
  try {
    return decodeURIComponent(slug)
  } catch {
    return slug
  }
}
