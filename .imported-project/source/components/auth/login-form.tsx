"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { authErrorMessage } from "./auth-helpers"
import { Loader2, Phone, ShieldCheck } from "lucide-react"

type Step = "phone" | "otp"

export function LoginForm({
  next,
  otpLength,
  resendSeconds,
}: {
  next: string
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

  const startCountdown = useCallback(
    (seconds: number) => {
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
    },
    [],
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  async function sendOtp(e?: React.FormEvent) {
    e?.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json()
      if (!res.ok) {
        // رمز فعّال بالفعل: ننتقل لشاشة الإدخال ونضبط العدّاد بالمدة المتبقية.
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

  async function resendOtp() {
    if (countdown > 0 || loading) return
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(authErrorMessage(data.error))
        if (typeof data.retryAfter === "number") startCountdown(data.retryAfter)
        return
      }
      setCode("")
      startCountdown(resendSeconds)
    } catch {
      setError("تعذّر الاتصال بالخادم. حاول مرة أخرى.")
    } finally {
      setLoading(false)
    }
  }

  async function verifyOtp(value: string) {
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: value, next }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(authErrorMessage(data.error))
        setCode("")
        return
      }
      router.replace(typeof data.redirect === "string" ? data.redirect : next)
      router.refresh()
    } catch {
      setError("تعذّر الاتصال بالخادم. حاول مرة أخرى.")
    } finally {
      setLoading(false)
    }
  }

  function onOtpChange(value: string) {
    setCode(value)
    if (value.length === otpLength && !loading) {
      void verifyOtp(value)
    }
  }

  if (step === "phone") {
    return (
      <form onSubmit={sendOtp} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">رقم الهاتف</Label>
          <div className="relative">
            <Phone className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="phone"
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
          <p className="text-xs text-muted-foreground">
            أدخل رقم هاتفك اليمني لإرسال رمز التحقق عبر رسالة نصية.
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={loading || phone.trim().length < 9} className="w-full">
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          إرسال الرمز
        </Button>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-1 text-center">
        <ShieldCheck className="size-6 text-primary" />
        <p className="text-sm text-muted-foreground">
          أدخل الرمز المكوّن من {otpLength} أرقام المُرسل إلى
        </p>
        <p dir="ltr" className="text-sm font-semibold tabular-nums">
          {displayPhone}
        </p>
      </div>

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
          onClick={resendOtp}
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
          تغيير رقم الهاتف
        </button>
      </div>
    </div>
  )
}
