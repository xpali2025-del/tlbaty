"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mic, MicOff, StickyNote, Square } from "lucide-react"

/** الحد الأقصى لطول الملاحظة — يُطبَّق أيضاً على الخادم. */
export const MAX_CUSTOMER_NOTE = 1000

/**
 * لغات التعرف المرتّبة حسب الأفضلية: اليمنية أولاً ثم بدائل عربية متاحة.
 * إذا رفض المتصفح اللغة الأولى ننتقل تلقائياً إلى التالية.
 */
const RECOGNITION_LANGS = ["ar-YE", "ar-SA", "ar-EG", "ar"] as const

// ---------- أنواع واجهة SpeechRecognition (غير موجودة في lib.dom بشكل قياسي) ----------

type SpeechAlternative = { transcript: string; confidence: number }
type SpeechResult = { readonly length: number; isFinal: boolean; [index: number]: SpeechAlternative }
type SpeechResultList = { readonly length: number; [index: number]: SpeechResult }

type SpeechRecognitionResultEvent = { resultIndex: number; results: SpeechResultList }
type SpeechRecognitionErrorEvent = { error: string }

type SpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

/** يعيد الباني المتاح في المتصفح، أو null إذا كانت الميزة غير مدعومة. */
function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null
  const w = window as SpeechWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function CustomerNoteSection({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState("")
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null)

  // لا نلمس الميكروفون إطلاقاً قبل ضغط الزر — لا يوجد أي فحص أو إذن عند التحميل.
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const langIndexRef = useRef(0)
  // نحتفظ بالنص الحالي في ref حتى يضيف المُعرِّف إليه دون حذف ما كتبه العميل.
  const valueRef = useRef(value)
  valueRef.current = value

  /** إيقاف الاستماع وتحرير الموارد. */
  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current
    recognitionRef.current = null
    if (rec) {
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      rec.onstart = null
      try {
        rec.abort()
      } catch {
        // المتصفح قد يرفض abort إذا كان متوقفاً بالفعل — لا يهم.
      }
    }
    setListening(false)
    setInterim("")
  }, [])

  // إيقاف الميكروفون عند مغادرة الصفحة أو إلغاء تحميل المكوّن.
  useEffect(() => {
    return () => {
      stopRecognition()
    }
  }, [stopRecognition])

  /** يضيف النص المتعرَّف عليه إلى الملاحظة الحالية دون حذفها. */
  const appendTranscript = useCallback(
    (transcript: string) => {
      const clean = transcript.replace(/\s+/g, " ").trim()
      if (!clean) return
      const current = valueRef.current
      const separator = current && !/\s$/.test(current) ? " " : ""
      onChange(`${current}${separator}${clean}`.slice(0, MAX_CUSTOMER_NOTE))
    },
    [onChange],
  )

  const startRecognition = useCallback(() => {
    const Recognition = getRecognitionConstructor()
    if (!Recognition) {
      setNotice({
        tone: "error",
        text: "التحويل من الصوت إلى نص غير مدعوم على هذا الجهاز، ويمكنك كتابة الملاحظة يدويًا.",
      })
      return
    }

    setNotice(null)
    let gotSpeech = false

    const rec = new Recognition()
    rec.lang = RECOGNITION_LANGS[langIndexRef.current] ?? "ar"
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onstart = () => setListening(true)

    rec.onresult = (event) => {
      let pending = ""
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ""
        if (result.isFinal) {
          gotSpeech = true
          appendTranscript(text)
        } else {
          pending += text
        }
      }
      setInterim(pending)
    }

    rec.onerror = (event) => {
      const code = event.error
      if (code === "not-allowed" || code === "service-not-allowed") {
        setNotice({
          tone: "error",
          text: "تم رفض إذن الميكروفون. يمكنك كتابة الملاحظة يدويًا.",
        })
      } else if (code === "no-speech" || code === "aborted") {
        setNotice({
          tone: "info",
          text: "لم يتم التعرف على الكلام، حاول مرة أخرى أو اكتب الملاحظة يدويًا.",
        })
      } else if (code === "language-not-supported") {
        // ننتقل إلى لغة عربية بديلة في المحاولة القادمة.
        langIndexRef.current = Math.min(langIndexRef.current + 1, RECOGNITION_LANGS.length - 1)
        setNotice({
          tone: "info",
          text: "لم يتم التعرف على الكلام، حاول مرة أخرى أو اكتب الملاحظة يدويًا.",
        })
      } else {
        setNotice({
          tone: "error",
          text: "التحويل من الصوت إلى نص غير مدعوم على هذا الجهاز، ويمكنك كتابة الملاحظة يدويًا.",
        })
      }
      stopRecognition()
    }

    // ينتهي تلقائياً بعد انتهاء كلام العميل لأن continuous = false.
    rec.onend = () => {
      if (!gotSpeech) {
        setNotice((prev) =>
          prev ?? {
            tone: "info",
            text: "لم يتم التعرف على الكلام، حاول مرة أخرى أو اكتب الملاحظة يدويًا.",
          },
        )
      }
      stopRecognition()
    }

    recognitionRef.current = rec
    try {
      // طلب إذن الميكروفون يحدث هنا فقط — بعد ضغط العميل على الزر.
      rec.start()
      setListening(true)
    } catch {
      setNotice({
        tone: "error",
        text: "التحويل من الصوت إلى نص غير مدعوم على هذا الجهاز، ويمكنك كتابة الملاحظة يدويًا.",
      })
      stopRecognition()
    }
  }, [appendTranscript, stopRecognition])

  const remaining = MAX_CUSTOMER_NOTE - value.length

  return (
    <section className="rounded-2xl border border-border bg-card p-4" aria-labelledby="customer-note-title">
      <h2 id="customer-note-title" className="mb-1 flex items-center gap-2 text-base font-bold">
        <StickyNote className="h-4 w-4 text-primary" aria-hidden="true" />
        ملاحظة على الطلب (اختياري)
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        اكتب أي تفاصيل إضافية تريد إبلاغنا بها
      </p>

      <label htmlFor="customer-note" className="sr-only">
        ملاحظة على الطلب
      </label>
      {/*
        زر الميكروفون داخل مستطيل النص نفسه (أيقونة فقط بلا نص).
        الواجهة RTL فالنص يبدأ من اليمين، لذلك نضع الزر في الزاوية السفلية اليسرى
        ونضيف مساحة سفلية للـ textarea حتى لا يمرّ النص تحت الزر.
      */}
      <div className="relative">
        <textarea
          id="customer-note"
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_CUSTOMER_NOTE))}
          maxLength={MAX_CUSTOMER_NOTE}
          rows={4}
          placeholder="اكتب أي تفاصيل إضافية تريد إبلاغنا بها"
          className={`w-full resize-y rounded-xl border bg-background px-3 pb-14 pt-2 text-sm leading-relaxed outline-none transition-colors ${
            listening ? "border-primary" : "border-border focus:border-primary"
          }`}
        />

        {/* زر أيقونة الميكروفون: يبدأ الاستماع، ويتحول إلى زر إيقاف أثناء الاستماع */}
        <button
          type="button"
          onClick={listening ? stopRecognition : startRecognition}
          aria-label={listening ? "إيقاف الاستماع" : "تحويل الكلام إلى نص"}
          aria-pressed={listening}
          title={listening ? "إيقاف الاستماع" : "تحويل الكلام إلى نص"}
          className={`absolute bottom-2.5 left-2.5 flex h-11 w-11 items-center justify-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            listening
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-accent"
          }`}
        >
          {listening ? (
            <Square className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Mic className="h-5 w-5" aria-hidden="true" />
          )}
        </button>

        {/* حالة الاستماع + عدّاد الأحرف داخل المستطيل أيضاً */}
        <div className="pointer-events-none absolute bottom-4 right-3 flex items-center gap-2">
          {listening && (
            <span className="flex items-center gap-1.5 text-xs font-bold text-primary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
              جارٍ الاستماع...
            </span>
          )}
          <span
            className={`text-xs tabular-nums ${remaining <= 50 ? "text-destructive" : "text-muted-foreground"}`}
            dir="ltr"
          >
            {value.length} / {MAX_CUSTOMER_NOTE}
          </span>
        </div>
      </div>

      {/* النص المؤقت أثناء التعرف — لا يُحفظ حتى يصبح نهائياً */}
      {listening && interim && (
        <p className="mt-1.5 text-xs italic text-muted-foreground" aria-live="polite">
          {interim}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className={`mt-2 flex items-start gap-1.5 text-xs leading-relaxed ${
            notice.tone === "error" ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          <MicOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {notice.text}
        </p>
      )}
    </section>
  )
}
