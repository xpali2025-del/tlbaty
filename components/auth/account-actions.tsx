"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { flushCustomerSync } from "@/components/customer-sync"
import { clearLocalData } from "@/lib/customer-local-data"
import { Loader2, LogOut, MonitorSmartphone } from "lucide-react"

export function AccountActions() {
  const router = useRouter()
  const [loading, setLoading] = useState<"one" | "all" | null>(null)
  const [error, setError] = useState("")

  async function logout(scope: "one" | "all") {
    setError("")
    setLoading(scope)
    try {
      // آخر تعديلات السلة والرغبات تصل حسابه قبل الخروج.
      await flushCustomerSync()
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: scope === "all" }),
      })
      if (!res.ok) {
        setError("تعذّر تسجيل الخروج. حاول مرة أخرى.")
        return
      }
      // بياناته محفوظة في حسابه؛ نمسحها من هذا الجهاز كي لا يراها المستخدم التالي على جهاز مشترك.
      clearLocalData()
      router.replace("/login")
      router.refresh()
    } catch {
      setError("تعذّر الاتصال بالخادم. حاول مرة أخرى.")
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="mb-8 flex flex-col gap-3">
      <Button
        variant="outline"
        className="min-h-12 justify-center gap-2 border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
        onClick={() => logout("one")}
        disabled={loading !== null}
      >
        {loading === "one" ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
        تسجيل الخروج
      </Button>

      <Button
        variant="ghost"
        className="min-h-11 justify-center text-muted-foreground"
        onClick={() => logout("all")}
        disabled={loading !== null}
      >
        {loading === "all" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <MonitorSmartphone className="size-4" />
        )}
        تسجيل الخروج من جميع الأجهزة
      </Button>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
