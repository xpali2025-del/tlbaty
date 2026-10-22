"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { PublicSiteConfig } from "@/lib/site-config"
import { SITE_CONFIG } from "@/lib/site"

// يوفّر إعدادات المتجر (من لوحة الإدارة) لمكوّنات العميل: الشعار، أرقام التواصل، روابط التواصل، طرق الدفع.
// الإعدادات تأتي من الخادم في الـlayout، فلا طلب إضافي من المتصفح.

const FALLBACK: PublicSiteConfig = {
  name: SITE_CONFIG.name,
  nameEn: SITE_CONFIG.nameEn,
  tagline: SITE_CONFIG.tagline,
  contact: { ...SITE_CONFIG.contact, secondaryPhone: "" },
  social: { ...SITE_CONFIG.social, x: "", youtube: "", snapchat: "", telegram: "" },
  footer: { ...SITE_CONFIG.footer },
  logoUrl: null,
  payments: { cashOnDelivery: true, manualTransfer: true, wallet: true },
}

const SiteConfigContext = createContext<PublicSiteConfig>(FALLBACK)

export function SiteConfigProvider({ config, children }: { config: PublicSiteConfig; children: ReactNode }) {
  return <SiteConfigContext.Provider value={config}>{children}</SiteConfigContext.Provider>
}

export function useSiteConfig(): PublicSiteConfig {
  return useContext(SiteConfigContext)
}
