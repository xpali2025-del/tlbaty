"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { authErrorMessage } from "./auth-helpers"
import { CheckCircle2, Loader2, Phone } from "lucide-react"

type Step = "phone" | "otp" | "done"

export function ChangePhoneForm({
  otpLength,
  resendSeconds,
}: {
  otpLength: number
  resendSeconds: number
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>("phone")
  const [phone, setPhone] = useState("")
  const [displayPhone, setDisplayPhone] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startCountdown = useCallback((seconds: number) => {
    setCountdown(seconds)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  async function requestChange(e?: React.FormEvent) {
    e?.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/auth/change-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "send", phone }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === "RESEND_TOO_SOON") {
          setDisplayPhone(phone)
          setStep("otp")
          startCountdown(typeof data.retryAfter === "number" ? data.retryAfter : resendSeconds)
          return
        }
        setError(authErrorMessage(data.error))
        return
      }
      setDisplayPhone(phone)
      setStep("otp")
      setCode("")
      startCountdown(resendSeconds)
    } catch {
      setError("تعذّر الاتصال بالخادم. حاول مرة أخرى.")
    } finally {
      setLoading(false)
    }
  }

  async function confirmChange(value: string) {
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/auth/change-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "verify", phone, code: value }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(authErrorMessage(data.error))
        setCode("")
        return
      }
      setStep("done")
      setTimeout(() => {
        router.replace("/account")
        router.refresh()
      }, 1200)
    } catch {
      setError("تعذّر الاتصال بالخادم. حاول مرة أخرى.")
    } finally {
      setLoading(false)
    }
  }

  function onOtpChange(value: string) {
    setCode(value)
    if (value.length === otpLength && !loading) {
      void confirmChange(value)
    }
  }

  if (step === "done") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center">
        <CheckCircle2 className="size-8 text-primary" />
        <p className="text-sm font-medium">تم تغيير رقم هاتفك بنجاح.</p>
        <p className="text-xs text-muted-foreground">جارٍ تحويلك إلى حسابك…</p>
      </div>
    )
  }

  if (step === "phone") {
    return (
      <form onSubmit={requestChange} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-phone">رقم الهاتف الجديد</Label>
          <div className="relative">
            <Phone className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="new-phone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              autoComplete="tel"
              placeholder="7XXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="pr-10 text-left"
              required
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={loading || phone.trim().length < 9} className="w-full">
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          إرسال رمز التحقق
        </Button>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-center text-sm text-muted-foreground">
        أدخل الرمز المُرسل إلى{" "}
        <span dir="ltr" className="font-semibold">
          {displayPhone}
        </span>
      </p>

      <div className="flex justify-center" dir="ltr">
        <InputOTP maxLength={otpLength} value={code} onChange={onOtpChange} disabled={loading}>
          <InputOTPGroup>
            {Array.from({ length: otpLength }).map((_, i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>

      {error ? (
        <p role="alert" className="text-center text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          جارٍ التحقق…
        </p>
      ) : null}

      <div className="flex flex-col items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => requestChange()}
          disabled={countdown > 0 || loading}
        >
          {countdown > 0 ? `إعادة الإرسال بعد ${countdown} ثانية` : "إعادة إرسال الرمز"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setStep("phone")
            setCode("")
            setError("")
          }}
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          تعديل الرقم الجديد
        </button>
      </div>
    </div>
  )
}
