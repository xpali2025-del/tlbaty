"use client"

import { useState } from "react"
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Navigation, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GovernorateCombobox } from "@/components/governorate-combobox"
import { ADDRESS_LABELS, isValidCoords, MAX_ADDRESS_LABEL, type SavedAddress, type SavedAddressInput } from "@/hooks/use-saved-addresses"
import { isPresetLabel, normalizeAddressLabel, validateAddressName, validateAddressPhone } from "@/lib/address-form"

type Coords = { latitude: number; longitude: number; accuracy: number; capturedAt: string }
type LocationStatus = "idle" | "loading" | "success" | "error"

const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

/**
 * نموذج إضافة/تعديل عنوان محفوظ (صفحة «عناويني»). نفس قواعد صفحة الدفع: لا يُحفظ العنوان إلا بموقع GPS صالح،
 * ويُلغى الموقع إن تغيّرت المدينة أو العنوان لعنوان قيد التعديل حتى لا يبقى موقع قديم لعنوان جديد.
 */
export function AddressForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: SavedAddress
  onSave: (input: SavedAddressInput) => void
  onCancel: () => void
}) {
  const [preset, setPreset] = useState<string>(() => {
    if (!initial?.label) return "المنزل"
    return isPresetLabel(initial.label) ? initial.label : "أخرى"
  })
  const [customLabel, setCustomLabel] = useState(() => (initial?.label && !isPresetLabel(initial.label) && initial.label !== "أخرى" ? initial.label : ""))
  const [name, setName] = useState(initial?.customerName ?? "")
  const [phone, setPhone] = useState(initial?.phone ?? "")
  const [city, setCity] = useState(initial?.city ?? "")
  const [address, setAddress] = useState(initial?.address ?? "")
  const [coords, setCoords] = useState<Coords | null>(
    initial ? { latitude: initial.latitude, longitude: initial.longitude, accuracy: initial.accuracy, capturedAt: initial.locationCapturedAt } : null,
  )
  const [status, setStatus] = useState<LocationStatus>(initial ? "success" : "idle")
  const [locationError, setLocationError] = useState("")
  const [notice, setNotice] = useState("")
  const [touched, setTouched] = useState(false)

  const nameError = validateAddressName(name)
  const phoneError = validateAddressPhone(phone)
  const fieldsValid = !nameError && !phoneError && city.trim().length > 0 && address.trim().length > 0
  const locationValid = status === "success" && coords !== null && isValidCoords(coords.latitude, coords.longitude)

  const dropLocationIfMoved = (next: { city?: string; address?: string }) => {
    if (!initial || !coords) return
    const movedCity = next.city !== undefined && next.city.trim() !== initial.city.trim()
    const movedAddress = next.address !== undefined && next.address.trim() !== initial.address.trim()
    if (movedCity || movedAddress) {
      setCoords(null)
      setStatus("idle")
      setNotice("تغيّر العنوان، حدّد موقعك الجديد قبل الحفظ.")
    }
  }

  const capture = () => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setStatus("error")
      setLocationError("هذا الجهاز أو المتصفح لا يدعم تحديد الموقع.")
      return
    }
    setStatus("loading")
    setLocationError("")
    setNotice("")
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        if (!isValidCoords(latitude, longitude)) {
          setStatus("error")
          setLocationError("تعذّر الحصول على إحداثيات صالحة. حاول مرة أخرى.")
          return
        }
        setCoords({ latitude, longitude, accuracy: typeof accuracy === "number" && accuracy >= 0 ? accuracy : 0, capturedAt: new Date().toISOString() })
        setStatus("success")
      },
      (err) => {
        setStatus("error")
        setCoords(null)
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? "تم رفض إذن الموقع. اسمح بالوصول للموقع لحفظ العنوان."
            : err.code === err.POSITION_UNAVAILABLE
              ? "خدمة الموقع متوقفة. شغّل GPS ثم حاول مجدداً."
              : err.code === err.TIMEOUT
                ? "تعذّر تحديد الموقع خلال الوقت المحدد. حاول مرة أخرى."
                : "تعذّر تحديد الموقع. حاول مرة أخرى.",
        )
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!fieldsValid || !locationValid || !coords) return
    const label = preset === "أخرى" ? normalizeAddressLabel(customLabel) ?? "أخرى" : preset
    onSave({
      label,
      customerName: name.trim(),
      phone: phone.trim(),
      city: city.trim(),
      address: address.trim(),
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      locationCapturedAt: coords.capturedAt,
    })
  }

  const inputCls = "w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">تسمية العنوان</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="تسمية العنوان">
          {ADDRESS_LABELS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={preset === l}
              onClick={() => setPreset(l)}
              className={`min-h-11 rounded-full border px-4 text-sm font-medium transition ${preset === l ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
            >
              {l}
            </button>
          ))}
        </div>
        {preset === "أخرى" && (
          <input
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value.slice(0, MAX_ADDRESS_LABEL))}
            placeholder="اكتب اسماً للعنوان (مثل: بيت العائلة)"
            aria-label="اسم العنوان"
            className={`${inputCls} mt-2`}
          />
        )}
      </fieldset>

      <div>
        <label htmlFor="addr-name" className="mb-1 block text-sm font-medium">الاسم الثلاثي للمستلم</label>
        <input id="addr-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} aria-invalid={touched && !!nameError} />
        {touched && nameError && <p className="mt-1 text-xs text-destructive">{nameError}</p>}
      </div>

      <div>
        <label htmlFor="addr-phone" className="mb-1 block text-sm font-medium">رقم الهاتف (9 أرقام)</label>
        <div className="relative">
          <Phone className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            id="addr-phone"
            type="tel"
            dir="ltr"
            inputMode="numeric"
            maxLength={9}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
            placeholder="781595851"
            className={`${inputCls} pr-10 text-right`}
            aria-invalid={touched && !!phoneError}
          />
        </div>
        {touched && phoneError && <p className="mt-1 text-xs text-destructive">{phoneError}</p>}
      </div>

      <div>
        <label htmlFor="addr-city" className="mb-1 block text-sm font-medium">المدينة</label>
        <GovernorateCombobox
          id="addr-city"
          value={city}
          onChange={(v) => {
            setCity(v)
            dropLocationIfMoved({ city: v })
          }}
          placeholder="اختر المدينة"
        />
      </div>

      <div>
        <label htmlFor="addr-address" className="mb-1 block text-sm font-medium">العنوان التفصيلي</label>
        <textarea
          id="addr-address"
          value={address}
          rows={2}
          maxLength={1000}
          onChange={(e) => {
            setAddress(e.target.value)
            dropLocationIfMoved({ address: e.target.value })
          }}
          placeholder="الحي، الشارع، جوار ..."
          className={`${inputCls} resize-none`}
        />
      </div>

      <div className="rounded-xl border border-border p-3">
        <p className="mb-2 flex items-center gap-2 text-sm font-bold">
          <Navigation className="h-4 w-4 text-primary" aria-hidden="true" />
          موقعك على الخريطة
        </p>
        {notice && <p className="mb-2 flex items-center gap-1 text-xs text-amber-600"><AlertCircle className="h-4 w-4" aria-hidden="true" />{notice}</p>}
        {status === "success" && coords ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="flex items-center gap-1 font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              تم تحديد الموقع • دقة {Math.round(coords.accuracy)} متر
            </span>
            <a href={mapsUrl(coords.latitude, coords.longitude)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              معاينة
            </a>
            <button type="button" onClick={capture} className="min-h-11 text-xs text-muted-foreground underline">إعادة التحديد</button>
          </div>
        ) : (
          <Button type="button" variant="outline" className="min-h-11 gap-2" onClick={capture} disabled={status === "loading"}>
            {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Navigation className="h-4 w-4" aria-hidden="true" />}
            تحديد موقعي الحالي
          </Button>
        )}
        {status === "error" && locationError && <p className="mt-2 flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-4 w-4" aria-hidden="true" />{locationError}</p>}
        {touched && !locationValid && status !== "error" && <p className="mt-2 text-xs text-destructive">حدّد موقعك لحفظ العنوان.</p>}
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="h-11 flex-1">حفظ العنوان</Button>
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onCancel}>إلغاء</Button>
      </div>
    </form>
  )
}
