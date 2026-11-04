"use client"

import { createContext, useContext } from "react"
import type { AdminProduct } from "@/lib/admin"

// ما تستطيع شاشات اللوحة فعله ببيانات الصفحة في المتصفح دون إعادة تحميلها من الخادم:
// الحفظ يعيد العنصر المحفوظ فيُدرَج في القائمة مباشرة.
export type ManageStoreActions = {
  /** يضيف المنتج إلى القائمة أو يستبدل نسخته، ويعلّم البيانات المتأثرة في الشاشات الأخرى قديمة. */
  upsertProduct: (item: AdminProduct) => void
}

const ManageStoreContext = createContext<ManageStoreActions | null>(null)

export const ManageStoreProvider = ManageStoreContext.Provider

export function useManageStore(): ManageStoreActions {
  const value = useContext(ManageStoreContext)
  if (!value) throw new Error("useManageStore يُستعمل داخل لوحة الإدارة فقط")
  return value
}
