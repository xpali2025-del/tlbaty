import { createClient, type SanityClient } from "next-sanity"
import { isOrdersConfigured, ordersApiVersion, ordersDataset, ordersProjectId, ordersToken } from "./env"

// ============================================
// عميل Sanity للكتابة — خاص بمشروع الطلبات المستقل
// - يُستخدم فقط من الخادم (مسار /api/orders)
// - useCdn: false لأن الكتابة يجب أن تمر مباشرة على الـ API
// - يعيد null عند غياب الإعدادات ليتصرف الموقع بأمان (فتح واتساب مباشرة)
// ============================================

export const ordersClient: SanityClient | null = isOrdersConfigured
  ? createClient({
      projectId: ordersProjectId,
      dataset: ordersDataset,
      apiVersion: ordersApiVersion,
      token: ordersToken,
      useCdn: false,
    })
  : null
