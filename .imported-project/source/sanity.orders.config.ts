"use client"

import { defineConfig } from "sanity"
import { structureTool } from "sanity/structure"
import { orderType } from "@/sanity/orders/schema/order"
import { courierType } from "@/sanity/orders/schema/courier"
import { otpCodeType } from "@/sanity/orders/schema/otp-code"
import { customerType } from "@/sanity/orders/schema/customer"
import { customerSessionType } from "@/sanity/orders/schema/customer-session"
import { authEventType } from "@/sanity/orders/schema/auth-event"
import { ordersProjectId, ordersDataset, ordersApiVersion } from "@/sanity/orders/env"
import { silverBlueTheme } from "@/sanity/theme"

// ============================================
// إعداد استوديو الطلبات (/studio-orders) — مشروع Sanity مستقل
// يعرض الطلبات الواردة من صفحة الدفع فقط.
// ============================================

export default defineConfig({
  name: "tagelin-orders",
  title: "طلبات تاج لاين",
  basePath: "/studio-orders",
  projectId: ordersProjectId,
  dataset: ordersDataset,
  apiVersion: ordersApiVersion,
  theme: silverBlueTheme,
  schema: {
    types: [orderType, courierType, otpCodeType, customerType, customerSessionType, authEventType],
  },
  plugins: [structureTool()],
})
