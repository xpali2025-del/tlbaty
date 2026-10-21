import { defineField, defineType } from "sanity"

// ============================================
// مخطط رمز التحقق (OTP) — تخزين خادمي بحت.
//
// لا يُحفظ الرمز كنص صريح إطلاقاً: نحفظ codeHash فقط (scrypt + salt).
// السجل قصير العمر ويُلغى بعد نجاح التحقق أو انتهاء الصلاحية.
// لا يُعرض هذا المستند للعميل في أي واجهة.
// ============================================

export const otpCodeType = defineType({
  name: "otpCode",
  title: "رموز التحقق",
  type: "document",
  fields: [
    defineField({
      name: "phone",
      title: "رقم الهاتف المحلي",
      type: "string",
      readOnly: true,
      description: "الرقم المحلي الموحّد (9 أرقام) الذي طُلب له الرمز.",
    }),
    defineField({
      name: "codeHash",
      title: "بصمة الرمز",
      type: "string",
      readOnly: true,
      description: "scrypt(الرمز + salt) — لا يمكن استرجاع الرمز الأصلي منها.",
    }),
    defineField({
      name: "salt",
      title: "Salt",
      type: "string",
      readOnly: true,
    }),
    defineField({
      name: "purpose",
      title: "الغرض",
      type: "string",
      readOnly: true,
      options: {
        list: [
          { title: "تسجيل الدخول", value: "login" },
          { title: "تغيير رقم الهاتف", value: "change_phone" },
        ],
      },
    }),
    defineField({
      name: "expiresAt",
      title: "تنتهي في",
      type: "datetime",
      readOnly: true,
    }),
    defineField({
      name: "attempts",
      title: "عدد محاولات التحقق",
      type: "number",
      readOnly: true,
      initialValue: 0,
    }),
    defineField({
      name: "verified",
      title: "تم التحقق",
      type: "boolean",
      readOnly: true,
      initialValue: false,
    }),
    defineField({
      name: "consumed",
      title: "مُستهلك / ملغى",
      type: "boolean",
      readOnly: true,
      initialValue: false,
      description: "يُرفع عند نجاح التحقق أو عند إبطال رمز سابق لنفس الرقم.",
    }),
    defineField({
      name: "provider",
      title: "مزوّد الإرسال",
      type: "string",
      readOnly: true,
    }),
    defineField({ name: "ip", title: "IP", type: "string", readOnly: true }),
    defineField({ name: "userAgent", title: "User Agent", type: "string", readOnly: true }),
    defineField({ name: "createdAt", title: "أُنشئ في", type: "datetime", readOnly: true }),
  ],
  orderings: [
    { title: "الأحدث أولاً", name: "createdAtDesc", by: [{ field: "createdAt", direction: "desc" }] },
  ],
  preview: {
    select: { phone: "phone", verified: "verified", createdAt: "createdAt" },
    prepare: ({ phone, verified, createdAt }) => ({
      title: `${phone ?? "?"} — ${verified ? "تم التحقق" : "بانتظار"}`,
      subtitle: createdAt ?? "",
    }),
  },
})
