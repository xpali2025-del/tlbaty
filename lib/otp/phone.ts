// ============================================
// هاتف المصادقة — يعيد تصدير منطق التوحيد الموحّد في المشروع.
//
// المصدر الوحيد لتوحيد أرقام العملاء يبقى lib/phone.ts حتى يتطابق
// معرّف/مطابقة الطلبات مع منطق تسجيل الدخول تماماً. لا تُكرّر التوحيد هنا.
// ============================================
export {
  normalizeLocalPhone,
  normalizeAndValidateLocalPhone,
  isValidLocalPhone,
  maskLocalPhone,
  normalizeInternationalPhone,
  maskPhone,
  SUPPORTED_COUNTRIES,
  toEnglishDigits,
  LOCAL_PHONE_LENGTH,
} from "@/lib/phone"
