"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Lock, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { login } from "../auth-actions"

export function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await login(username, password)
      if (result?.error) {
        setError(result.error)
        return
      }
      router.replace("/manage")
      router.refresh()
    })
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Lock className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-xl">لوحة الإدارة</CardTitle>
        <CardDescription>سجّل الدخول لإدارة محتوى المتجر</CardDescription>
      </CardHeader>
      <CardContent>
        {!configured ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>غير مُهيّأ</AlertTitle>
            <AlertDescription>
              أضف متغير البيئة <code className="font-mono">MANAGE_PASSWORD</code> لتفعيل تسجيل الدخول.
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">اسم المستخدم</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="odoo"
                autoFocus
                dir="ltr"
                autoComplete="username"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">كلمة المرور</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                dir="ltr"
                autoComplete="current-password"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={isPending || !username || !password}>
              {isPending ? "جارٍ التحقق..." : "تسجيل الدخول"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
