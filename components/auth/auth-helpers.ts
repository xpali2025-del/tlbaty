"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// رسائل الأخطاء الموحّدة بالعربية لكل رموز الخطأ القادمة من مسارات المصادقة.
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_PHONE: "رقم الهاتف غير صحيح. تأكد من الرقم ومن كود الدولة.",
  COUNTRY_NOT_ALLOWED: "تسجيل الدخول غير متاح حالياً لهذه الدولة.",
  INVALID_JSON: "طلب غير صالح. حاول مرة أخرى.",
  INVALID_CODE: "الرمز غير صحيح. تأكد من الأرقام وحاول مجدداً.",
  NO_CODE: "لا يوجد رمز فعّال. اطلب رمزاً جديداً.",
  EXPIRED: "انتهت صلاحية الرمز. اطلب رمزاً جديداً.",
  TOO_MANY_ATTEMPTS: "تجاوزت عدد المحاولات المسموح بها. حاول لاحقاً.",
  RATE_LIMITED: "عدد كبير من الطلبات. الرجاء المحاولة بعد قليل.",
  RESEND_TOO_SOON: "الرجاء الانتظار قبل إعادة إرسال الرمز.",
  SEND_FAILED: "تعذّر إرسال الرمز حالياً. حاول مرة أخرى.",
  AUTH_NOT_CONFIGURED: "خدمة تسجيل الدخول غير متاحة حالياً.",
  AUTH_REQUIRED: "الرجاء تسجيل الدخول أولاً.",
  ACCOUNT_BLOCKED: "هذا الحساب محظور. تواصل مع الدعم.",
  PHONE_IN_USE: "رقم الهاتف مستخدم في حساب آخر.",
  SAME_PHONE: "هذا هو رقمك الحالي. أدخل رقماً مختلفاً.",
  NETWORK: "تعذّر الاتصال. تأكد من الإنترنت وحاول مجدداً.",
}

export function authErrorMessage(code: string | undefined, fallback = "حدث خطأ، حاول مرة أخرى."): string {
  if (!code) return fallback
  return AUTH_ERROR_MESSAGES[code] ?? fallback
}

/** عدّاد تنازلي لإعادة إرسال الرمز. */
export function useResendCountdown() {
  const [remaining, setRemaining] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const clear = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  const start = useCallback(
    (seconds: number) => {
      clear()
      setRemaining(seconds)
      timer.current = setInterval(() => {
        setRemaining((prev) => {
          if (prev <= 1) {
            clear()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    },
    [clear],
  )

  useEffect(() => clear, [clear])

  return { remaining, start }
}
