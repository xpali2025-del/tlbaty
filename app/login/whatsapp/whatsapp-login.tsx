'use client'
import { useEffect, useRef, useState } from 'react'

type Step = 'idle' | 'waiting' | 'claimed' | 'expired'

const ERRORS: Record<string, string> = {
  INVALID_CODE: 'الرمز غير صحيح',
  EXPIRED: 'انتهت صلاحية الرمز، ابدأ من جديد',
  TOO_MANY_ATTEMPTS: 'تجاوزت عدد المحاولات، ابدأ من جديد',
  NO_CODE: 'انتهت صلاحية الرمز، ابدأ من جديد',
  CHALLENGE_EXPIRED: 'انتهت صلاحية الطلب، ابدأ من جديد',
  RATE_LIMITED: 'محاولات كثيرة، حاول لاحقًا',
  ACCOUNT_BLOCKED: 'هذا الحساب موقوف',
  AUTH_NOT_CONFIGURED: 'الدخول غير متاح حاليًا',
}

/** onSuccess: بدل الانتقال لصفحة أخرى (مثلاً داخل نافذة الدفع) نكمل في مكاننا والصفحة بحالتها. */
export function WhatsAppLogin({ onSuccess }: { onSuccess?: () => void } = {}) {
  const [step, setStep] = useState<Step>('idle')
  const [link, setLink] = useState<string>()
  const [token, setToken] = useState<string>()
  const [phoneMasked, setPhoneMasked] = useState<string>()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }
  useEffect(() => stopPolling, [])

  async function start() {
    setError(undefined)
    setBusy(true)
    try {
      const res = await fetch('/api/auth/chat-login/start', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) return setError(ERRORS[data.error] ?? 'تعذّر البدء، حاول مرة أخرى')
      setLink(data.link)
      setToken(data.token)
      setStep('waiting')
      stopPolling()
      timer.current = setInterval(async () => {
        const s = await fetch('/api/auth/chat-login/status').then((r) => r.json()).catch(() => null)
        if (!s) return
        if (s.state === 'claimed') {
          stopPolling()
          setPhoneMasked(s.phoneMasked)
          setStep('claimed')
        } else if (s.state === 'expired') {
          stopPolling()
          setStep('expired')
        }
      }, 2000)
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setError(undefined)
    setBusy(true)
    try {
      const res = await fetch('/api/auth/chat-login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (res.ok) {
        if (onSuccess) return onSuccess()
        return void (window.location.href = data.redirect ?? '/')
      }
      if (['EXPIRED', 'TOO_MANY_ATTEMPTS', 'NO_CODE', 'CHALLENGE_EXPIRED'].includes(data.error)) setStep('expired')
      setError(ERRORS[data.error] ?? 'تعذّر التحقق')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex max-w-sm flex-col gap-4">
      {(step === 'idle' || step === 'expired') && (
        <>
          {step === 'expired' && <p role="alert">انتهت صلاحية الطلب. ابدأ من جديد.</p>}
          <button onClick={start} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
            الدخول عبر واتساب
          </button>
        </>
      )}

      {step === 'waiting' && (
        <>
          <p>اضغط الزر لفتح واتساب وأرسل الرسالة الجاهزة كما هي، وسيصلك الرمز في المحادثة نفسها.</p>
          <a href={link} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-primary px-4 py-2 text-center text-primary-foreground">
            افتح واتساب
          </a>
          <p className="text-sm">
            إن لم يفتح واتساب، أرسل يدويًا للرقم نفسه: <span dir="ltr" className="font-mono">رمز الدخول: {token}</span>
          </p>
          <p role="status" className="text-sm text-muted-foreground">بانتظار رسالتك…</p>
        </>
      )}

      {step === 'claimed' && (
        <form onSubmit={verify} className="flex flex-col gap-3">
          <p>أرسلنا الرمز إلى واتساب على الرقم <span dir="ltr">{phoneMasked}</span>. اكتبه هنا:</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            required
            dir="ltr"
            className="rounded border px-3 py-2 text-center tracking-widest"
            placeholder="••••••"
          />
          <button disabled={busy || !code} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
            تأكيد
          </button>
        </form>
      )}

      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  )
}
