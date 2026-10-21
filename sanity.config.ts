"use client"

import { defineConfig } from "sanity"
import { structureTool } from "sanity/structure"
import { visionTool } from "@sanity/vision"
import { projectId, dataset, apiVersion } from "@/sanity/env"
import { schemaTypes } from "@/sanity/schemaTypes"
import { silverBlueTheme } from "@/sanity/theme"
import { storeDashboardTool } from "@/sanity/components/StoreDashboard"

// ============================================
// إعداد استوديو المتجر (/studio)
// يدير المنتجات والأقسام والبراندات والسلايدر والكوبونات والمراجعات
// والإعلانات وإعدادات الموقع، مع لوحة رئيسية مخصّصة.
// ============================================

export default defineConfig({
  name: "tagelin-store",
  title: "متجر تاج لاين",
  basePath: "/studio",
  projectId,
  dataset,
  theme: silverBlueTheme,
  schema: { types: schemaTypes },
  tools: (prev) => [storeDashboardTool, ...prev],
  plugins: [structureTool(), visionTool({ defaultApiVersion: apiVersion })],
})
