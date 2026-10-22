// تحقق مدخلات الحوالة المشترك بين الطلبات وشحن الرصيد (على الخادم دائماً).

/** تحقّق اسم مرسل الحوالة على الخادم (لا نثق بتحقق الواجهة). */
export function isValidSenderName(value: string): boolean {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (trimmed.length < 5 || trimmed.length > 80) return false
  if (trimmed.split(" ").filter((w) => w.length >= 2).length < 2) return false
  return /^[\p{L}\s'.\-]+$/u.test(trimmed)
}

/** تحقّق رقم الحوالة — يبقى نصاً ولا يُحوَّل إلى Number. */
export function isValidTransferReference(value: string): boolean {
  if (value.length < 4 || value.length > 40) return false
  const digits = value.replace(/[^\d٠-٩۰-۹]/g, "")
  if (digits.length < 4) return false
  return /^[\d٠-٩۰-۹A-Za-z\-/ ]+$/.test(value)
}

