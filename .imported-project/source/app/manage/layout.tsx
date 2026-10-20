import type React from "react"
import type { Metadata } from "next"
import { Toaster } from "@/components/ui/sonner"

export const metadata: Metadata = {
  title: "لوحة الإدارة | Tageline",
  description: "لوحة إدارة محتوى المتجر",
  robots: { index: false, follow: false },
}

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30" dir="rtl">
      {children}
      <Toaster position="top-center" richColors />
    </div>
  )
}
