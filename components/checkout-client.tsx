"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { SafeImage } from "@/components/safe-image"
import {
  Check,
  MessageCircle,
  MapPin,
  MapPinned,
  Phone,
  User,
  Truck,
  Store,
  Zap,
  Tag,
  Loader2,
  Navigation,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Pencil,
  Trash2,
  Plus,
  X,
} from "lucide-react"
import { Header } from "@/components/header"
import { FooterClient } from "@/components/footer-client"
import { useCart } from "@/components/cart-provider"
import { useCurrency } from "@/components/currency-provider"
import { useToast } from "@/hooks/use-toast"
import {
  useSavedAddresses,
  isValidCoords,
  type SavedAddress,
} from "@/hooks/use-saved-addresses"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useSiteConfig } from "@/components/site-config-provider"
import { GovernorateCombobox } from "@/components/governorate-combobox"
import { buildProductNumber } from "@/lib/product-number"
import { LoginDialog } from "@/components/auth/login-dialog"
import { FALLBACK_SHIPPING_METHODS, resolveShippingMethods } from "@/lib/shipping"
import type { Coupon, ShippingMethod, ShippingZone } from "@/lib/types"
import type { PaymentAccount } from "@/lib/payment"
import { CustomerNoteSection, MAX_CUSTOMER_NOTE } from "@/components/checkout-customer-note"
import {
  PaymentSection,
  EMPTY_PAYMENT_SELECTION,
  validateSenderName,
  validateTransferReference,
  type PaymentSelection,
} from "@/components/checkout-payment-section"

// أيقونة كل نوع طريقة توصيل
const SHIPPING_ICONS = {
  express: Zap,
  standard: Truck,
  pickup: Store,
} as const

type LocationStatus = "idle" | "loading" | "success" | "error"
type CheckoutView = "choose" | "form" | "selected"
type AddressSource = "saved" | "new"

type Coords = {
  latitude: number
  longitude: number
  accuracy: number
  capturedAt: string
}

function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

function formatDate(iso?: string): string {
  if (!iso) return "-"
  try {
    return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function CheckoutClient({
  coupons,
  shippingZones,
  paymentAccounts,
  paymentProofReady,
}: {
  coupons: Coupon[]
  shippingZones: ShippingZone[]
  paymentAccounts: PaymentAccount[]
  paymentProofReady: boolean
}) {
  const SITE_CONFIG = useSiteConfig()
  const { items, subtotal, clearCart } = useCart()
  const { currency, format, convert } = useCurrency()
  const router = useRouter()
  const { toast } = useToast()
  const { addresses, hydrated, addAddress, updateAddress, removeAddress } = useSavedAddresses()

  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [city, setCity] = useState("")
  const [address, setAddress] = useState("")
  const [shipping, setShipping] = useState<string>("standard")
  const [couponCode, setCouponCode] = useState("")
  const [appliedCoupon, setAppliedCoupon] = useState<{ coupon: Coupon; amount: number } | null>(null)
  const [couponMessage, setCouponMessage] = useState("")
  const [nameError, setNameError] = useState("")
  const [phoneError, setPhoneError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  // رقم الطلب بعد نجاح الحفظ — وجوده يعني عرض شاشة النجاح.
  const [placedOrderNumber, setPlacedOrderNumber] = useState<string | null>(null)
  // رابط واتساب بعد الحفظ: زر احتياطي في شاشة النجاح إن حجب المتصفح النافذة المنبثقة.
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null)
  // انتهاء الجلسة أثناء الدفع: نافذة تسجيل دخول داخل الصفحة بدل مغادرتها.
  const [loginOpen, setLoginOpen] = useState(false)
  const [sessionLost, setSessionLost] = useState(false)
  const loginResolver = useRef<((ok: boolean) => void) | null>(null)
  // مفتاح محاولة الدفع: يُنشأ مرة لكل محاولة ويُعاد استخدامه عند إعادة الإرسال، فلا يتكرر الطلب ولا يُخصم المخزون مرتين.
  const orderKey = useRef<{ key: string; cart: string } | null>(null)

  const requestLogin = () =>
    new Promise<boolean>((resolve) => {
      loginResolver.current = resolve
      setLoginOpen(true)
    })
  const finishLogin = (ok: boolean) => {
    loginResolver.current?.(ok)
    loginResolver.current = null
    setLoginOpen(false)
    if (ok) setSessionLost(false)
  }

  // عند العودة للتبويب (قد تكون الجلسة انتهت أو أُلغيت من جهاز آخر) نتحقق بهدوء ونُنبّه قبل أن يملأ العميل بياناته.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return
      fetch("/api/auth/me", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setSessionLost(d?.authenticated === false))
        .catch(() => {})
    }
    document.addEventListener("visibilitychange", check)
    return () => document.removeEventListener("visibilitychange", check)
  }, [])

  // ملاحظة العميل — اختيارية تماماً ولا تمنع إرسال الطلب.
  const [customerNote, setCustomerNote] = useState("")

  // حالة الدفع في الواجهة — لا تحتوي حالة تحقق إطلاقاً (الخادم وحده يحدّدها).
  const [payment, setPayment] = useState<PaymentSelection>(EMPTY_PAYMENT_SELECTION)
  const [paymentErrors, setPaymentErrors] = useState<{
    account?: string
    senderName?: string
    reference?: string
    proof?: string
  }>({})

  // حالة الموقع الجغرافي للطلب الحالي
  const [coords, setCoords] = useState<Coords | null>(null)
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle")
  const [locationError, setLocationError] = useState("")

  // إدارة العنوان
  const [view, setView] = useState<CheckoutView>("choose")
  const [addressSource, setAddressSource] = useState<AddressSource | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [locationNotice, setLocationNotice] = useState("")

  const initRef = useRef(false)
  const editOriginal = useRef<{ city: string; address: string } | null>(null)
  const addressSectionRef = useRef<HTMLDivElement | null>(null)

  // تهيئة العرض بعد الترطيب فقط (مرة واحدة): إن لم توجد عناوين نبدأ بنموذج
  // العنوان الأول، وإلا نعرض قسم اختيار العنوان دون اختيار تلقائي.
  useEffect(() => {
    if (!hydrated || initRef.current) return
    initRef.current = true
    if (addresses.length === 0) {
      setView("form")
      setAddressSource("new")
    } else {
      setView("choose")
    }
  }, [hydrated, addresses.length])

  // التحقق من الاسم الثلاثي: ثلاث كلمات على الأقل، كل كلمة حرفان فأكثر
  const validateName = (value: string) => {
    const words = value.trim().split(/\s+/).filter((w) => w.length >= 2)
    if (words.length < 3) {
      return "يرجى إدخال الاسم الثلاثي (الاسم الأول واسم الأب واسم الجد)"
    }
    return ""
  }

  // التحقق من رقم الهاتف: تسعة أرقام بالضبط
  const validatePhone = (value: string) => {
    const digits = value.replace(/\D/g, "")
    if (digits.length !== 9) {
      return "رقم الهاتف يجب أن يكون 9 أرقام بالضبط (مثال: 777777777)"
    }
    return ""
  }

  // طرق التوصيل المتاحة حسب المحافظة المختارة:
  // - إن وُجد إعداد خاص بالمحافظة استُخدم.
  // - وإلا فالإعداد الافتراضي (باقي المحافظات).
  // - وإلا القيمة الاحتياطية الآمنة.
  const availableMethods = useMemo<ShippingMethod[]>(
    () => resolveShippingMethods(shippingZones, city),
    [city, shippingZones],
  )

  // إبقاء الطريقة المختارة صالحة عند تغيّر المحافظة/الطرق المتاحة
  useEffect(() => {
    if (!availableMethods.some((m) => m.id === shipping)) {
      setShipping(availableMethods[0]?.id ?? "")
    }
  }, [availableMethods, shipping])

  const shippingMethod =
    availableMethods.find((s) => s.id === shipping) || availableMethods[0] || FALLBACK_SHIPPING_METHODS[0]
  const discountAmount = appliedCoupon?.amount || 0
  const total = Math.max(0, subtotal + shippingMethod.price - discountAmount)

  // صحة البيانات اليدوية (الاسم/الهاتف/المدينة/العنوان)
  const manualValid =
    !validateName(name) && !validatePhone(phone) && city.trim().length > 0 && address.trim().length > 0

  // صحة الموقع للطلب الحالي
  const locationValid =
    locationStatus === "success" &&
    coords !== null &&
    isValidCoords(coords.latitude, coords.longitude) &&
    Boolean(coords.capturedAt)

  // شروط تفعيل زر «حفظ واستخدام هذا العنوان»
  const canSaveAddress = manualValid && locationValid

  // التحقق من بيانات الدفع في الواجهة (الخادم يعيد التحقق دائماً)
  const validatePayment = () => {
    if (payment.method === "cash_on_delivery") return {}
    const next: typeof paymentErrors = {}
    if (!payment.accountId) next.account = "اختر حساب دفع واحداً."
    const senderErr = validateSenderName(payment.senderName)
    if (senderErr) next.senderName = senderErr
    const refErr = validateTransferReference(payment.reference)
    if (refErr) next.reference = refErr
    if (!payment.proofFile) next.proof = "صورة إثبات الحوالة مطلوبة."
    return next
  }

  const paymentReady =
    payment.method === "cash_on_delivery" ||
    (paymentProofReady &&
      Boolean(payment.accountId) &&
      !validateSenderName(payment.senderName) &&
      !validateTransferReference(payment.reference) &&
      payment.proofFile !== null)

  // شروط تفعيل إرسال الطلب
  const canSubmit =
    items.length > 0 &&
    manualValid &&
    locationValid &&
    paymentReady &&
    Boolean(selectedId) &&
    Boolean(addressSource)

  const applyCoupon = () => {
    const found = coupons.find((c) => c.code.toUpperCase() === couponCode.trim().toUpperCase())
    if (!found) {
      setCouponMessage("كود الخصم غير صحيح")
      setAppliedCoupon(null)
      return
    }
    if (found.minOrder && subtotal < found.minOrder) {
      setCouponMessage(`الحد الأدنى للطلب ${format(found.minOrder)}`)
      setAppliedCoupon(null)
      return
    }
    const amount =
      found.type === "percent" ? Math.round((subtotal * found.discount) / 100) : found.discount
    setAppliedCoupon({ coupon: found, amount })
    setCouponMessage("تم تطبيق الكود بنجاح")
  }

  // ============================================
  // الموقع الجغرافي
  // ============================================
  const resetLocation = () => {
    setCoords(null)
    setLocationStatus("idle")
    setLocationError("")
  }

  const captureLocation = () => {
    if (!manualValid) {
      toast({
        title: "أكمل البيانات أولاً",
        description: "يرجى إدخال الاسم والهاتف والمدينة والعنوان قبل تحديد الموقع.",
      })
      return
    }
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setLocationStatus("error")
      setLocationError("هذا الجهاز أو المتصفح لا يدعم تحديد الموقع المطلوب لإتمام الطلب.")
      return
    }

    setLocationStatus("loading")
    setLocationError("")
    setLocationNotice("")

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        if (!isValidCoords(latitude, longitude)) {
          setLocationStatus("error")
          setLocationError("تعذّر الحصول على إحداثيات صالحة. حاول مرة أخرى.")
          return
        }
        setCoords({
          latitude,
          longitude,
          accuracy: typeof accuracy === "number" && accuracy >= 0 ? accuracy : 0,
          capturedAt: new Date().toISOString(),
        })
        setLocationStatus("success")
        setLocationError("")
      },
      (err) => {
        setLocationStatus("error")
        setCoords(null)
        if (err.code === err.PERMISSION_DENIED) {
          setLocationError("تم رفض إذن الموقع. يجب السماح بالوصول إلى الموقع لإتمام الطلب.")
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setLocationError("خدمة الموقع متوقفة. شغّل GPS ثم حاول مجدداً.")
        } else if (err.code === err.TIMEOUT) {
          setLocationError("تعذّر تحديد الموقع خلال الوقت المحدد. حاول مرة أخرى.")
        } else {
          setLocationError("تعذّر تحديد الموقع. حاول مرة أخرى.")
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  // إبطال الإحداثيات عند تغيير المدينة أو العنوان لعنوان محفوظ قيد التعديل
  const maybeInvalidateOnEdit = (field: "city" | "address", value: string) => {
    if (!editingId || !editOriginal.current) return
    const changed =
      (field === "city" && value.trim() !== editOriginal.current.city.trim()) ||
      (field === "address" && value.trim() !== editOriginal.current.address.trim())
    if (changed && coords) {
      resetLocation()
      setLocationNotice("تم تغيير العنوان، يجب تحديد الموقع الجديد قبل الحفظ.")
    }
  }

  // ============================================
  // اختيار / إضافة / تعديل / حذف العناوين
  // ============================================
  const selectSavedAddress = (a: SavedAddress) => {
    setName(a.customerName)
    setPhone(a.phone)
    setCity(a.city)
    setAddress(a.address)
    setNameError("")
    setPhoneError("")
    setCoords({
      latitude: a.latitude,
      longitude: a.longitude,
      accuracy: a.accuracy,
      capturedAt: a.locationCapturedAt,
    })
    setLocationStatus("success")
    setLocationError("")
    setLocationNotice("")
    setAddressSource("saved")
    setSelectedId(a.id)
    setEditingId(null)
    editOriginal.current = null
    setView("selected")
    toast({ title: "تم اختيار العنوان المحفوظ" })
  }

  const startNewAddress = () => {
    setEditingId(null)
    editOriginal.current = null
    // نحتفظ بالاسم والهاتف من آخر عنوان محفوظ لتسهيل الطلب
    if (addresses[0]) {
      setName(addresses[0].customerName)
      setPhone(addresses[0].phone)
    } else {
      setName("")
      setPhone("")
    }
    setCity("")
    setAddress("")
    setNameError("")
    setPhoneError("")
    resetLocation()
    setLocationNotice("")
    setAddressSource("new")
    setSelectedId(null)
    setView("form")
  }

  const startEdit = (a: SavedAddress) => {
    setEditingId(a.id)
    editOriginal.current = { city: a.city, address: a.address }
    setName(a.customerName)
    setPhone(a.phone)
    setCity(a.city)
    setAddress(a.address)
    setNameError("")
    setPhoneError("")
    setCoords({
      latitude: a.latitude,
      longitude: a.longitude,
      accuracy: a.accuracy,
      capturedAt: a.locationCapturedAt,
    })
    setLocationStatus("success")
    setLocationError("")
    setLocationNotice("")
    setView("form")
  }

  const cancelForm = () => {
    setEditingId(null)
    editOriginal.current = null
    setLocationNotice("")
    if (addresses.length > 0) {
      // العودة إلى الاختيار دون تغيير النسخة المحفوظة
      if (!selectedId) resetLocation()
      setView("choose")
    }
  }

  const handleSaveAddress = () => {
    const nameErr = validateName(name)
    const phoneErr = validatePhone(phone)
    setNameError(nameErr)
    setPhoneError(phoneErr)
    if (nameErr || phoneErr || !city.trim() || !address.trim()) {
      toast({ title: "يرجى تصحيح البيانات", description: nameErr || phoneErr || "أكمل المدينة والعنوان التفصيلي." })
      return
    }
    if (!locationValid || !coords) {
      toast({ title: "الموقع مطلوب", description: "حدّد موقعك الحالي قبل حفظ العنوان." })
      return
    }

    const payload = {
      customerName: name.trim(),
      phone: phone.trim(),
      city: city.trim(),
      address: address.trim(),
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      locationCapturedAt: coords.capturedAt,
    }

    if (editingId) {
      updateAddress(editingId, payload)
      setSelectedId(editingId)
      setAddressSource("saved")
      toast({ title: "تم حفظ التعديلات بنجاح" })
    } else {
      const created = addAddress(payload)
      setSelectedId(created.id)
      setAddressSource("new")
      toast({ title: "تم حفظ العنوان بنجاح" })
    }
    setEditingId(null)
    editOriginal.current = null
    setLocationNotice("")
    setView("selected")
  }

  const confirmDelete = (id: string) => {
    const wasSelected = selectedId === id
    removeAddress(id)
    if (wasSelected) {
      // إلغاء اختيار العنوان المحذوف وتعطيل الإرسال حتى اختيار عنوان آخر
      setSelectedId(null)
      setAddressSource(null)
      resetLocation()
      // نبقي بيانات الاسم/الهاتف لكن نطلب اختيار عنوان جديد
      setCity("")
      setAddress("")
    }
    const remaining = addresses.filter((a) => a.id !== id)
    if (remaining.length === 0) {
      setAddressSource("new")
      setView("form")
    } else if (wasSelected) {
      setView("choose")
    }
    toast({ title: "تم حذف العنوان" })
  }

  const selectedAddress = selectedId ? addresses.find((a) => a.id === selectedId) : null

  const scrollToAddress = () => {
    addressSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (items.length === 0) {
      toast({ title: "السلة فارغة", description: "أضف منتجات قبل إتمام الطلب" })
      return
    }

    const nameErr = validateName(name)
    const phoneErr = validatePhone(phone)
    setNameError(nameErr)
    setPhoneError(phoneErr)
    if (nameErr || phoneErr) {
      toast({ title: "يرجى تصحيح البيانات", description: nameErr || phoneErr })
      return
    }

    // التحقق الإلزامي من العنوان والموقع داخل handleSubmit (لا نعتمد على disabled فقط)
    if (!selectedId || !addressSource || !locationValid || !coords) {
      toast({
        title: "الموقع مطلوب",
        description: "اختر عنوانًا محفوظًا أو أضف عنوانًا جديدًا وحدد موقعه لإرسال الطلب.",
      })
      scrollToAddress()
      return
    }

    // التحقق من بيانات الدفع داخل handleSubmit أيضاً (لا نعتمد على disabled فقط)
    const paymentIssues = validatePayment()
    setPaymentErrors(paymentIssues)
    if (Object.keys(paymentIssues).length > 0) {
      toast({
        title: "أكمل بيانات الدفع",
        description:
          paymentIssues.account ??
          paymentIssues.senderName ??
          paymentIssues.reference ??
          paymentIssues.proof ??
          "راجع بيانات الدفع.",
      })
      return
    }

    if (payment.method === "manual_transfer" && !paymentProofReady) {
      toast({
        title: "الدفع بالتحويل غير متاح حالياً",
        description: "خطأ في إعداد الموقع. الرجاء استخدام الدفع عند الاستلام.",
      })
      return
    }

    // يُدرج رقم المنتج في الرسالة ليطابق ما يظهر في لوحة إدارة الطلبات.
    const lines = items.map(
      (i) =>
        `• ${i.name}\n  رقم المنتج: ${buildProductNumber(i.productId)}\n  المقاس: ${i.size} | اللون: ${i.color} | الكمية: ${i.quantity} | ${format(i.price * i.quantity)}`,
    )
    const locationLink = mapsUrl(coords.latitude, coords.longitude)
    const chosenAccount = paymentAccounts.find((a) => a.id === payment.accountId)

    // تفاصيل الدفع في رسالة واتساب — بلا أي رابط للإثبات أو بيانات فك تشفير.
    const paymentLines =
      payment.method === "cash_on_delivery"
        ? ["*الدفع:*", "طريقة الدفع: الدفع عند الاستلام", "حالة الدفع: بانتظار التحصيل", ""]
        : [
            "*الدفع:*",
            `طريقة الدفع: تحويل عبر ${chosenAccount?.providerName ?? "حساب دفع"}`,
            `اسم المرسل: ${payment.senderName.trim()}`,
            `رقم الحوالة: ${payment.reference.trim()}`,
            "حالة الدفع: جارٍ التحقق من الدفع",
            "",
          ]

    // الرسالة تُبنى بعد نجاح الحفظ حتى تحمل رقم الطلب الذي أنشأه الخادم.
    // لا نضيف أي رابط تتبع — العميل يفتح شاشة التتبع من الموقع بنفسه.
    const buildMessage = (orderNumber: string) => [
      `*طلب جديد من ${SITE_CONFIG.name}*`,
      "",
      `*رقم الطلب: ${orderNumber}*`,
      "",
      "*بيانات العميل:*",
      `الاسم: ${name}`,
      `الهاتف: ${phone}`,
      `المدينة: ${city}`,
      `العنوان: ${address}`,
      `نوع العنوان: ${addressSource === "saved" ? "عنوان محفوظ" : "عنوان جديد"}`,
      "",
      "*موقع التوصيل:*",
      `رابط الموقع: ${locationLink}`,
      `دقة الموقع: ${Math.round(coords.accuracy)} متر`,
      "",
      "*المنتجات:*",
      ...lines,
      "",
      ...paymentLines,
      `طريقة التوصيل: ${shippingMethod.name}`,
      appliedCoupon ? `كود الخصم: ${appliedCoupon.coupon.code} (-${format(discountAmount)})` : "",
      // تُدرج ملاحظة العميل فقط عند وجودها
      customerNote.trim() ? `ملاحظة العميل: ${customerNote.trim()}` : "",
      "",
      `*الإجمالي: ${format(total)}*`,
    ]
      .filter(Boolean)
      .join("\n")

    // نفتح تبويباً فارغاً الآن (ضمن نقرة المستخدم) لتفادي حظر النوافذ المنبثقة،
    // ثم نوجّهه إلى واتساب فقط بعد نجاح حفظ الطلب في قاعدة البيانات.
    const waWindow = typeof window !== "undefined" ? window.open("", "_blank") : null

    const openWhatsApp = (orderNumber: string) => {
      const waUrl = `https://wa.me/${SITE_CONFIG.contact.whatsapp}?text=${encodeURIComponent(
        buildMessage(orderNumber),
      )}`
      setWhatsappUrl(waUrl)
      if (waWindow && !waWindow.closed) {
        waWindow.location.href = waUrl
      } else {
        // بعد إعادة تسجيل الدخول انتهت «نقرة المستخدم» فقد يحجب المتصفح النافذة؛ ولا نترك الصفحة،
        // بل يبقى زر واتساب في شاشة النجاح.
        window.open(waUrl, "_blank")
      }
    }

    setSubmitting(true)
    try {
      // نرسل البيانات والصورة معاً كـ multipart/form-data.
      // العميل لا يرسل حالة دفع ولا رقم حساب ولا اسم مزوّد — فقط معرّف الحساب.
      // المفتاح مرتبط بمحتوى السلة: إن تغيّرت السلة بين محاولتين فهي طلب مختلف بمفتاح جديد.
      const cartSignature = JSON.stringify(items.map((i) => [i.productId, i.size, i.color, i.quantity]))
      if (orderKey.current?.cart !== cartSignature) orderKey.current = { key: crypto.randomUUID(), cart: cartSignature }
      const orderPayload = {
        clientOrderKey: orderKey.current.key,
        customerName: name,
        phone,
        city,
        address,
        latitude: coords.latitude,
        longitude: coords.longitude,
        locationAccuracy: coords.accuracy,
        locationCapturedAt: coords.capturedAt,
        addressSource,
        // نسجّل الأسعار بالعملة التي اختارها العميل وقت الطلب
        items: items.map((i) => ({ ...i, price: convert(i.price) })),
        shippingMethod: shippingMethod.name,
        shippingPrice: convert(shippingMethod.price),
        couponCode: appliedCoupon?.coupon.code ?? "",
        discount: convert(discountAmount),
        subtotal: convert(subtotal),
        total: convert(total),
        currency: currency.symbol,
        currencyCode: currency.code,
        paymentMethod: payment.method,
        paymentAccountId: payment.method === "manual_transfer" ? payment.accountId : "",
        transferSenderName: payment.method === "manual_transfer" ? payment.senderName.trim() : "",
        transferReference: payment.method === "manual_transfer" ? payment.reference.trim() : "",
        // الخادم يتحقق منها ويقصّها مرة أخرى — لا نثق بالواجهة.
        customerNote: customerNote.trim().slice(0, MAX_CUSTOMER_NOTE),
      }

      const body = new FormData()
      body.append("order", JSON.stringify(orderPayload))
      if (payment.method === "manual_transfer" && payment.proofFile) {
        body.append("paymentProof", payment.proofFile)
      }

      let res = await fetch("/api/orders", { method: "POST", body })

      // انتهت الجلسة أثناء الدفع: نافذة تسجيل دخول داخل الصفحة (بياناتك وموقعك وصورة الحوالة تبقى)،
      // ثم نعيد الإرسال تلقائياً بنفس مفتاح الطلب، فلا يتكرر إن كان قد حُفظ فعلاً.
      if (res.status === 401) {
        if (waWindow && !waWindow.closed) waWindow.close()
        const loggedIn = await requestLogin()
        if (!loggedIn) {
          toast({ title: "لم يكتمل تسجيل الدخول", description: "سجّل دخولك ثم اضغط «تأكيد الطلب» مجدداً. بياناتك محفوظة." })
          return
        }
        res = await fetch("/api/orders", { method: "POST", body })
      }

      const data = await res.json().catch(() => null)

      if (res.ok && data?.ok) {
        const savedNumber = typeof data.orderNumber === "string" ? data.orderNumber : ""
        openWhatsApp(savedNumber)
        orderKey.current = null // الطلب القادم محاولة جديدة بمفتاح جديد
        clearCart()
        // نعرض رقم الطلب للعميل مع زر التتبع بدل التحويل الفوري للرئيسية،
        // فيستطيع نسخ الرقم واستخدامه في شاشة التتبع لاحقاً.
        setPlacedOrderNumber(savedNumber)
        return
      }

      if (waWindow && !waWindow.closed) waWindow.close()
      const code = data?.error as string | undefined
      const serverMessage = typeof data?.message === "string" ? (data.message as string) : ""
      const description =
        code === "LOCATION_REQUIRED"
          ? "موقع التوصيل مطلوب. حدّد موقعك ثم حاول مجدداً."
          : code === "INVALID_LOCATION"
            ? "إحداثيات الموقع غير صحيحة. أعد تحديد موقعك."
            : code === "PAYMENT_ACCOUNT_UNAVAILABLE"
              ? "حساب الدفع المختار غير متاح حالياً. اختر حساباً آخر أو استخدم الدفع عند الاستلام."
              : code === "DUPLICATE_TRANSFER_REFERENCE"
                ? "رقم الحوالة مستخدم في طلب آخر. تأكد من الرقم أو تواصل معنا."
                : serverMessage || "تعذّر حفظ الطلب. تأكد من اتصالك بالإنترنت وحاول مجدداً."

      if (code === "PAYMENT_ACCOUNT_UNAVAILABLE") setPaymentErrors({ account: description })
      if (code === "DUPLICATE_TRANSFER_REFERENCE") setPaymentErrors({ reference: description })
      if (code === "INVALID_PAYMENT_PROOF") setPaymentErrors({ proof: description })
      if (code === "INVALID_TRANSFER_SENDER") setPaymentErrors({ senderName: description })
      if (code === "INVALID_TRANSFER_REFERENCE") setPaymentErrors({ reference: description })

      toast({ title: "حدث خطأ، يرجى المحاولة مرة أخرى", description })
    } catch {
      if (waWindow && !waWindow.closed) waWindow.close()
      toast({
        title: "حدث خطأ، يرجى المحاولة مرة أخرى",
        description: "تعذّر حفظ الطلب. تأكد من اتصالك بالإنترنت وحاول مجدداً.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  // شاشة نجاح الطلب — تُعرض قبل فحص السلة الفارغة لأن clearCart أفرغها.
  if (placedOrderNumber !== null) {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-2xl px-4 py-12">
          <div className="bg-card border border-border rounded-2xl p-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-8 w-8 text-primary" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold mb-2">تم استلام طلبك</h1>
            <p className="text-muted-foreground text-sm leading-relaxed mb-5">
              يمكنك متابعة حالة هذا الطلب وكل طلباتك في أي وقت من شاشة «طلباتي».
            </p>

            {placedOrderNumber ? (
              <div className="mb-6 rounded-xl border border-border bg-muted/40 p-4">
                <p className="text-xs text-muted-foreground mb-1">رقم الطلب</p>
                <p className="font-mono text-lg font-bold tracking-wide" dir="ltr">
                  {placedOrderNumber}
                </p>
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              {whatsappUrl ? (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full bg-emerald-600 px-6 py-3 font-bold text-white"
                >
                  إرسال تفاصيل الطلب إلى المتجر عبر واتساب
                </a>
              ) : null}
              {/* شاشة "طلباتي" تعتمد على تسجيل الدخول وتعرض كل الطلبات تلقائياً */}
              <Link
                href="/orders"
                className="rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground"
              >
                عرض طلباتي
              </Link>
              <Link
                href="/shop"
                className="rounded-full border border-border px-6 py-3 font-bold text-foreground"
              >
                متابعة التسوق
              </Link>
            </div>
          </div>
        </main>
        <FooterClient />
      </>
    )
  }

  if (items.length === 0) {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-2xl px-4 py-12 text-center">
          <h1 className="text-2xl font-bold mb-3">السلة فارغة</h1>
          <p className="text-muted-foreground mb-6">أضف منتجات لإتمام الطلب</p>
          <button
            onClick={() => router.push("/shop")}
            className="bg-primary text-primary-foreground rounded-full px-6 py-3 font-bold"
          >
            تصفح المتجر
          </button>
        </main>
        <FooterClient />
      </>
    )
  }

  const showManualForm = view === "form"

  return (
    <>
      <Header />
      <LoginDialog open={loginOpen} onClose={() => finishLogin(false)} onLoggedIn={() => finishLogin(true)} />
      <main className="pb-12 mx-auto max-w-3xl px-4 py-6">
        {sessionLost && !loginOpen && (
          <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <p className="flex-1 text-amber-700">انتهت جلسة تسجيل الدخول. سجّل دخولك الآن وأكمل طلبك بنفس بياناتك.</p>
            <button type="button" onClick={() => void requestLogin()} className="rounded-full bg-primary px-4 py-1.5 font-bold text-primary-foreground">
              تسجيل الدخول
            </button>
          </div>
        )}
        {/* مؤشر الخطوات */}
        <div className="flex items-center justify-between mb-8 max-w-md mx-auto" aria-label="خطوات الطلب">
          {[
            { label: "السلة", done: true },
            { label: "البيانات", done: true },
            { label: "تأكيد الطلب", done: false, active: true },
          ].map((step, i, arr) => (
            <div key={step.label} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    step.active
                      ? "bg-primary text-primary-foreground"
                      : step.done
                        ? "bg-primary/10 text-primary border-2 border-primary"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  <Check className="w-5 h-5" />
                </div>
                <span
                  className={`text-xs font-medium ${
                    step.active || step.done ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < arr.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 ${step.done ? "bg-primary" : "bg-border"}`} />
              )}
            </div>
          ))}
        </div>

        {/* ملخص الطلب */}
        <section className="bg-card border border-border rounded-2xl p-5 mb-4">
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-primary rounded" />
            ملخص الطلب
          </h2>
          {items.map((item) => (
            <div key={`${item.productId}-${item.size}-${item.color}`} className="flex gap-3 py-3 border-b border-border last:border-0">
              <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-muted shrink-0">
                <SafeImage src={item.image} alt={item.name} fill sizes="64px" className="object-cover" />
              </div>
              <div className="flex-1 text-sm">
                <h3 className="font-bold">{item.name}</h3>
                <p className="text-muted-foreground text-xs">
                  المقاس: {item.size} | اللون: {item.color} | الكمية: {item.quantity}
                </p>
                <p className="font-bold text-primary mt-1">
                  {format(item.price * item.quantity)}
                </p>
              </div>
            </div>
          ))}
        </section>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* قسم العنوان والموقع */}
          <div ref={addressSectionRef} className="space-y-4">
            {!hydrated ? (
              <section className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  <span className="text-sm">جارٍ تحميل عناوينك المحفوظة...</span>
                </div>
              </section>
            ) : (
              <>
                {/* اختيار عنوان محفوظ أو إضافة جديد */}
                {view === "choose" && addresses.length > 0 && (
                  <section className="bg-card border border-border rounded-2xl p-5">
                    <h2 className="font-bold text-lg mb-1 flex items-center gap-2">
                      <MapPinned className="w-5 h-5 text-primary" aria-hidden="true" />
                      اختر عنوان التوصيل
                    </h2>
                    <p className="text-xs text-muted-foreground mb-4">
                      اختر أحد عناوينك المحفوظة أو أضف عنوانًا جديدًا. لن يتم اختيار أي عنوان تلقائيًا.
                    </p>

                    <div className="space-y-3">
                      {addresses.map((a) => (
                        <SavedAddressCard
                          key={a.id}
                          address={a}
                          onUse={() => selectSavedAddress(a)}
                          onEdit={() => startEdit(a)}
                          onDelete={() => confirmDelete(a.id)}
                        />
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={startNewAddress}
                      className="mt-4 w-full flex items-center justify-center gap-2 border-2 border-dashed border-primary/40 text-primary rounded-xl py-3 text-sm font-bold hover:bg-primary/5 transition-colors"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      إضافة عنوان جديد
                    </button>
                  </section>
                )}

                {/* ملخص العنوان المختار */}
                {view === "selected" && (
                  <section className="bg-card border border-border rounded-2xl p-5">
                    <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
                      <MapPinned className="w-5 h-5 text-primary" aria-hidden="true" />
                      عنوان التوصيل المختار
                    </h2>
                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 space-y-1 text-sm">
                      <p className="font-bold">{name}</p>
                      <p className="text-muted-foreground" dir="ltr">{phone}</p>
                      <p className="text-muted-foreground">{city}</p>
                      <p className="text-muted-foreground">{address}</p>
                      <p className="flex items-center gap-1 text-emerald-600 font-medium pt-1">
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                        الموقع محفوظ
                        {coords ? ` • دقة ${Math.round(coords.accuracy)} متر` : ""}
                      </p>
                      {coords && (
                        <a
                          href={mapsUrl(coords.latitude, coords.longitude)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                        >
                          <ExternalLink className="w-4 h-4" aria-hidden="true" />
                          معاينة الموقع على الخريطة
                        </a>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={captureLocation}
                        disabled={locationStatus === "loading"}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-60"
                      >
                        {locationStatus === "loading" ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <RefreshCw className="w-4 h-4" aria-hidden="true" />
                        )}
                        تحديث موقعي الحالي
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setView("choose")
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
                      >
                        <MapPin className="w-4 h-4" aria-hidden="true" />
                        تغيير العنوان
                      </button>
                    </div>
                    {locationStatus === "error" && locationError && (
                      <p className="mt-2 flex items-center gap-1 text-xs text-destructive">
                        <AlertCircle className="w-4 h-4" aria-hidden="true" />
                        {locationError}
                      </p>
                    )}
                  </section>
                )}

                {/* نموذج إدخال / تعديل العنوان */}
                {showManualForm && (
                  <section className="bg-card border border-border rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-1">
                      <h2 className="font-bold text-lg flex items-center gap-2">
                        <span className="w-1 h-5 bg-primary rounded" />
                        {editingId ? "تعديل العنوان" : "بيانات العميل والعنوان"}
                      </h2>
                      {addresses.length > 0 && (
                        <button
                          type="button"
                          onClick={cancelForm}
                          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-4 h-4" aria-hidden="true" />
                          إلغاء
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-4">
                      سيُحفظ هذا العنوان على هذا الجهاز لتسهيل طلباتك القادمة.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="relative">
                        <label htmlFor="name" className="block text-sm font-medium mb-1">الاسم الثلاثي</label>
                        <User className="absolute right-3 top-9 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        <input
                          id="name"
                          type="text"
                          value={name}
                          onChange={(e) => {
                            setName(e.target.value)
                            if (nameError) setNameError(validateName(e.target.value))
                          }}
                          onBlur={() => setNameError(validateName(name))}
                          placeholder="الاسم الأول واسم الأب واسم الجد"
                          aria-invalid={Boolean(nameError)}
                          aria-describedby={nameError ? "name-error" : undefined}
                          className={`w-full bg-background border rounded-xl pr-10 pl-4 py-3 text-sm focus:outline-none focus:ring-2 ${
                            nameError ? "border-destructive focus:ring-destructive" : "border-input focus:ring-primary"
                          }`}
                        />
                        {nameError && (
                          <p id="name-error" className="mt-1 text-xs text-destructive">{nameError}</p>
                        )}
                      </div>
                      <div className="relative">
                        <label htmlFor="phone" className="block text-sm font-medium mb-1">رقم الهاتف (9 أرقام)</label>
                        <Phone className="absolute right-3 top-9 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        <input
                          id="phone"
                          type="tel"
                          dir="ltr"
                          inputMode="numeric"
                          maxLength={9}
                          value={phone}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, "").slice(0, 9)
                            setPhone(digits)
                            if (phoneError) setPhoneError(validatePhone(digits))
                          }}
                          onBlur={() => setPhoneError(validatePhone(phone))}
                          placeholder="781595851"
                          aria-invalid={Boolean(phoneError)}
                          aria-describedby={phoneError ? "phone-error" : undefined}
                          className={`w-full bg-background border rounded-xl pr-10 pl-4 py-3 text-sm focus:outline-none focus:ring-2 text-right ${
                            phoneError ? "border-destructive focus:ring-destructive" : "border-input focus:ring-primary"
                          }`}
                        />
                        {phoneError && (
                          <p id="phone-error" className="mt-1 text-xs text-destructive">{phoneError}</p>
                        )}
                      </div>
                      <div className="relative sm:col-span-2">
                        <label htmlFor="city" className="block text-sm font-medium mb-1">المدينة</label>
                        <GovernorateCombobox
                          id="city"
                          value={city}
                          onChange={(v) => {
                            setCity(v)
                            maybeInvalidateOnEdit("city", v)
                          }}
                          placeholder="اختر المدينة"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor="address" className="block text-sm font-medium mb-1">العنوان التفصيلي</label>
                        <textarea
                          id="address"
                          value={address}
                          onChange={(e) => {
                            setAddress(e.target.value)
                            maybeInvalidateOnEdit("address", e.target.value)
                          }}
                          placeholder="أدخل العنوان بالتفصيل (الحي، الشارع، جوار ...)"
                          rows={2}
                          className="w-full bg-background border border-input rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                        />
                      </div>
                    </div>

                    {/* تحديد الموقع */}
                    <div className="mt-5 border-t border-border pt-4">
                      <h3 className="font-bold text-base flex items-center gap-2">
                        <Navigation className="w-4 h-4 text-primary" aria-hidden="true" />
                        تحديد موقع التوصيل الفعلي
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1 mb-3">
                        وجود إحداثيات صحيحة لموقع التوصيل مطلوب لإتمام الطلب.
                      </p>

                      {locationNotice && (
                        <p className="mb-3 flex items-center gap-1 text-xs text-amber-600">
                          <AlertCircle className="w-4 h-4" aria-hidden="true" />
                          {locationNotice}
                        </p>
                      )}

                      {locationStatus === "success" && coords ? (
                        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 space-y-2 text-sm">
                          <p className="flex items-center gap-1 text-emerald-600 font-medium">
                            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                            تم تحديد موقعك بنجاح • دقة {Math.round(coords.accuracy)} متر
                          </p>
                          <a
                            href={mapsUrl(coords.latitude, coords.longitude)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <ExternalLink className="w-4 h-4" aria-hidden="true" />
                            معاينة موقعي على الخريطة
                          </a>
                          <div>
                            <button
                              type="button"
                              onClick={captureLocation}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
                            >
                              <RefreshCw className="w-4 h-4" aria-hidden="true" />
                              إعادة تحديد الموقع
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={captureLocation}
                            disabled={!manualValid || locationStatus === "loading"}
                            className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-3 text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {locationStatus === "loading" ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                جارٍ تحديد موقعك الحالي...
                              </>
                            ) : (
                              <>
                                <Navigation className="w-4 h-4" aria-hidden="true" />
                                {locationStatus === "error" ? "إعادة المحاولة" : "تحديد موقعي الحالي"}
                              </>
                            )}
                          </button>
                          {!manualValid && (
                            <p className="text-xs text-muted-foreground">
                              أكمل الاسم والهاتف والمدينة والعنوان لتفعيل زر تحديد الموقع.
                            </p>
                          )}
                          {locationStatus === "error" && locationError && (
                            <p className="flex items-center gap-1 text-xs text-destructive">
                              <AlertCircle className="w-4 h-4" aria-hidden="true" />
                              {locationError}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* حفظ واستخدام العنوان */}
                    <button
                      type="button"
                      onClick={handleSaveAddress}
                      disabled={!canSaveAddress}
                      className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white py-3 text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <Check className="w-5 h-5" aria-hidden="true" />
                      {editingId ? "حفظ التعديلات" : "حفظ واستخدام هذا العنوان"}
                    </button>
                  </section>
                )}
              </>
            )}
          </div>

          {/* كود الخصم */}
          <section className="bg-card border border-border rounded-2xl p-5">
            <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
              <Tag className="w-5 h-5 text-primary" />
              كود الخصم
            </h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                placeholder="أدخل كود الخصم"
                className="flex-1 bg-background border border-input rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="button"
                onClick={applyCoupon}
                className="bg-primary text-primary-foreground rounded-xl px-5 py-3 text-sm font-bold hover:bg-primary/90 transition-colors"
              >
                تطبيق الكود
              </button>
            </div>
            {couponMessage && (
              <p className={`mt-2 text-xs ${appliedCoupon ? "text-emerald-600" : "text-destructive"}`}>
                {couponMessage}
              </p>
            )}
            {appliedCoupon && (
              <dl className="mt-3 pt-3 border-t border-border space-y-1 text-sm">
                <div className="flex justify-between text-emerald-600">
                  <dt>قيمة الخصم</dt>
                  <dd className="font-bold">- {format(discountAmount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="font-bold">المبلغ بعد الخصم</dt>
                  <dd className="font-bold text-primary">{format(total)}</dd>
                </div>
              </dl>
            )}
          </section>

          {/* طريقة التوصيل */}
          <section className="bg-card border border-border rounded-2xl p-5">
            <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
              <Truck className="w-5 h-5 text-primary" />
              طريقة التوصيل
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              {city
                ? `طرق التوصيل المتاحة لـ ${city}`
                : "اختر المدينة في بيانات العنوان لعرض طرق التوصيل المخصصة لها"}
            </p>
            <div
              className={`grid gap-3 ${
                availableMethods.length === 1
                  ? "grid-cols-1"
                  : availableMethods.length === 2
                    ? "grid-cols-1 sm:grid-cols-2"
                    : "grid-cols-1 sm:grid-cols-3"
              }`}
            >
              {availableMethods.map((method) => {
                const Icon = SHIPPING_ICONS[method.icon] ?? Truck
                const selected = shipping === method.id
                return (
                  <label
                    key={method.id}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border cursor-pointer transition-all ${
                      selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="shipping"
                      value={method.id}
                      checked={selected}
                      onChange={() => setShipping(method.id)}
                      className="sr-only"
                    />
                    <Icon className={`w-6 h-6 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="font-bold text-sm text-center">{method.name}</span>
                    {method.desc ? (
                      <span className="text-xs text-muted-foreground text-center">{method.desc}</span>
                    ) : null}
                    <span className="text-sm font-bold text-primary">
                      {method.price === 0 ? "مجاناً" : format(method.price)}
                    </span>
                    <span
                      className={`absolute top-2 left-2 w-4 h-4 rounded-full border-2 ${
                        selected ? "border-primary bg-primary" : "border-border"
                      }`}
                      aria-hidden="true"
                    />
                  </label>
                )
              })}
            </div>
          </section>

          {/* ملاحظة على الطلب (اختياري) — تظهر قبل قسم طريقة الدفع */}
          <CustomerNoteSection value={customerNote} onChange={setCustomerNote} />

          {/* طريقة الدفع */}
          <PaymentSection
            accounts={paymentAccounts}
            value={payment}
            onChange={(next) => {
              setPayment(next)
              setPaymentErrors({})
            }}
            formattedTotal={format(total)}
            encryptionReady={paymentProofReady}
            errors={paymentErrors}
          />

          {/* ملخص الفاتورة */}
          <section className="bg-card border border-border rounded-2xl p-5">
            <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
              <span className="w-1 h-5 bg-primary rounded" />
              ملخص الفاتورة
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">إجمالي المنتجات</dt>
                <dd>{format(subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">رسوم الشحن</dt>
                <dd>{format(shippingMethod.price)}</dd>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <dt>الخصم</dt>
                  <dd>- {format(discountAmount)}</dd>
                </div>
              )}
            </dl>
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 mt-4 flex justify-between items-baseline">
              <span className="font-bold">الإجمالي النهائي</span>
              <span className="font-bold text-2xl text-primary">
                {format(total)}
              </span>
            </div>
          </section>

          {!canSubmit && hydrated && (
            <p className="flex items-center gap-2 text-sm text-amber-600 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              {!paymentReady
                ? "أكمل بيانات الدفع: اختر حساب الدفع وأدخل اسم المرسل ورقم الحوالة وصورة الإثبات."
                : "اختر عنوانًا محفوظًا أو أضف عنوانًا جديدًا وحدد موقعه لإرسال الطلب."}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !canSubmit}
            aria-busy={submitting}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl py-4 font-bold text-lg flex items-center justify-center gap-3 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
                <span>جارٍ حفظ الطلب...</span>
              </>
            ) : (
              <>
                <MessageCircle className="w-6 h-6" />
                <span className="flex flex-col items-start">
                  <span>إتمام الطلب عبر واتساب</span>
                  <span className="text-xs font-normal opacity-90">سيتم فتح واتساب مع تفاصيل طلبك</span>
                </span>
              </>
            )}
          </button>
        </form>
      </main>
      <FooterClient />
    </>
  )
}

// ============================================
// بطاقة عنوان محفوظ
// ============================================
function SavedAddressCard({
  address,
  onUse,
  onEdit,
  onDelete,
}: {
  address: SavedAddress
  onUse: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const hasValidLocation = isValidCoords(address.latitude, address.longitude)

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="space-y-1 text-sm">
        <p className="font-bold">{address.customerName}</p>
        <p className="text-muted-foreground" dir="ltr">{address.phone}</p>
        <p className="text-muted-foreground">{address.city}</p>
        <p className="text-muted-foreground">{address.address}</p>
        <p
          className={`flex items-center gap-1 font-medium pt-1 ${
            hasValidLocation ? "text-emerald-600" : "text-destructive"
          }`}
        >
          {hasValidLocation ? (
            <>
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              الموقع محفوظ • دقة {Math.round(address.accuracy)} متر
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4" aria-hidden="true" />
              الموقع غير صالح — يلزم تحديده
            </>
          )}
        </p>
        {hasValidLocation && (
          <a
            href={mapsUrl(address.latitude, address.longitude)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
            عرض على الخريطة
          </a>
        )}
        <p className="text-xs text-muted-foreground pt-1">آخر تحديث: {formatDate(address.updatedAt)}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onUse}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary text-primary-foreground px-3 py-2 text-sm font-bold hover:bg-primary/90 transition-colors"
        >
          <Check className="w-4 h-4" aria-hidden="true" />
          استخدام هذا العنوان
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          <Pencil className="w-4 h-4" aria-hidden="true" />
          تعديل
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 text-destructive px-3 py-2 text-sm font-medium hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
          حذف
        </button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>هل تريد حذف هذا العنوان المحفوظ؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف العنوان من هذا الجهاز فقط ولن يؤثر ذلك على طلباتك السابقة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
