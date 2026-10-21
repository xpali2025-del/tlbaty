// ============================================
// نظام العملات وأسعار الصرف
// ============================================
// أسعار المنتجات مخزّنة دائماً بالعملة الأساسية (الريال اليمني القديم).
// كل عملة تحمل "سعر صرف" = كم يساوي 1 من هذه العملة بالعملة الأساسية.
//   - العملة الأساسية (الريال اليمني القديم): rate = 1
//   - الريال السعودي: rate = 140  (أي 1 ريال سعودي = 140 ريال يمني قديم)
//   - الريال اليمني الجديد: rate = 1/2.8 ≈ 0.357  (140 قديم = 392 جديد)
// السعر المعروض = السعر الأساسي ÷ سعر الصرف.
// هذه القيم قابلة للتعديل بالكامل من لوحة تحكم Sanity.
// ============================================

export interface Currency {
  /** رمز مختصر فريد للعملة، مثل YER أو SAR */
  code: string
  /** اسم العملة كما يظهر للعميل */
  name: string
  /** الرمز المعروض بجانب السعر، مثل ر.ي أو ر.س */
  symbol: string
  /** سعر الصرف: كم يساوي 1 من هذه العملة بالعملة الأساسية (الريال اليمني القديم) */
  rate: number
}

export interface CurrencySettings {
  currencies: Currency[]
  /** رمز العملة الافتراضية التي تُعرض للعميل قبل اختياره */
  defaultCode: string
}

/** رمز العملة الأساسية التي تُخزَّن بها أسعار المنتجات */
export const BASE_CURRENCY_CODE = "YER"

/** قيم افتراضية آمنة تُستخدم عند غياب إعدادات Sanity */
export const DEFAULT_CURRENCIES: Currency[] = [
  { code: "YER", name: "ريال يمني (قديم)", symbol: "ر.ي", rate: 1 },
  { code: "YER_NEW", name: "ريال يمني (جديد)", symbol: "ر.ي.ج", rate: 1 / 2.8 },
  { code: "SAR", name: "ريال سعودي", symbol: "ر.س", rate: 140 },
]

export const DEFAULT_CURRENCY_SETTINGS: CurrencySettings = {
  currencies: DEFAULT_CURRENCIES,
  defaultCode: "YER",
}

/** يحوّل سعراً أساسياً (بالريال اليمني القديم) إلى قيمة بالعملة المختارة */
export function convertPrice(basePrice: number, currency: Currency): number {
  const rate = currency && Number.isFinite(currency.rate) && currency.rate > 0 ? currency.rate : 1
  const value = (Number.isFinite(basePrice) ? basePrice : 0) / rate
  return Math.round(value)
}

/** ينسّق السعر الأساسي كنص جاهز للعرض مع رمز العملة */
export function formatPrice(basePrice: number, currency: Currency): string {
  const value = convertPrice(basePrice, currency)
  return `${value.toLocaleString("en-US")} ${currency?.symbol ?? ""}`.trim()
}

/** يبحث عن عملة بالرمز مع قيمة احتياطية آمنة */
export function findCurrency(currencies: Currency[], code: string | null | undefined): Currency | undefined {
  if (!code) return undefined
  return currencies.find((c) => c.code === code)
}

/** يضمن قائمة عملات صالحة غير فارغة */
export function normalizeCurrencies(currencies: Currency[] | null | undefined): Currency[] {
  const valid = (currencies ?? []).filter(
    (c): c is Currency => Boolean(c && c.code && c.symbol && Number.isFinite(c.rate) && c.rate > 0),
  )
  return valid.length > 0 ? valid : DEFAULT_CURRENCIES
}
