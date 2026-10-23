"use client"

import { Phone } from "lucide-react"
import { Input } from "@/components/ui/input"
import { DEFAULT_LOGIN_COUNTRY, toEnglishDigits } from "@/lib/phone"

export type CountryOption = { code: string; name: string; flag: string; example: string }

/** الخيار الاحتياطي (اليمن) إن لم تصل قائمة الدول من الخادم. */
export const YEMEN_ONLY: CountryOption[] = [{ code: DEFAULT_LOGIN_COUNTRY, name: "اليمن", flag: "🇾🇪", example: "7XXXXXXXX" }]

/**
 * يركّب الرقم الدولي من الدولة المختارة وما كتبه العميل. من كتب رقمه بكوده (+ أو 00) يُرسَل كما كتبه،
 * والخادم يتحقق منه ومن أن دولته مفعّلة.
 */
export function composePhone(code: string, input: string): string {
  const raw = toEnglishDigits(input.trim())
  if (raw.startsWith("+") || raw.startsWith("00")) return raw
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "")
  // كتب كود الدولة بلا + (967777123456): نحترمه بدل تكراره. الرقم المحلي 9 أرقام، فالأطول منها يحمل الكود.
  if (digits.startsWith(code) && digits.length > 9) return `+${digits}`
  return `+${code}${digits}`
}

/** هل في الحقل ما يكفي لمحاولة الإرسال (الخادم هو من يحكم بالصلاحية). */
export function hasPhoneDigits(input: string): boolean {
  return toEnglishDigits(input).replace(/\D/g, "").length >= 8
}

export function PhoneField({
  id,
  value,
  onChange,
  country,
  onCountryChange,
  countries,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  country: string
  onCountryChange: (code: string) => void
  countries: CountryOption[]
}) {
  const options = countries.length > 0 ? countries : YEMEN_ONLY
  const current = options.find((c) => c.code === country) ?? options[0]
  return (
    <div dir="ltr" className="flex gap-2">
      {options.length > 1 ? (
        <select
          aria-label="كود الدولة"
          value={current.code}
          onChange={(e) => onCountryChange(e.target.value)}
          className="h-10 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
        >
          {options.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} +{c.code}
            </option>
          ))}
        </select>
      ) : (
        <span
          aria-label={`كود الدولة: ${current.name}`}
          className="flex h-10 shrink-0 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground"
        >
          {current.flag} +{current.code}
        </span>
      )}
      <div className="relative flex-1">
        <Phone className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          dir="ltr"
          autoComplete="tel-national"
          placeholder={current.example}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-10 text-left"
          required
        />
      </div>
    </div>
  )
}
