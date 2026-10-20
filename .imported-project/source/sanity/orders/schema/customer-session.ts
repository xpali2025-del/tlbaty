import { defineField, defineType } from "sanity"

// ============================================
// مخطط جلسة العميل — الجلسة الآمنة بعد نجاح OTP.
//
// لا يُحفظ توكن الجلسة الخام: نحفظ tokenHash (sha256) فقط، والتوكن نفسه
// يبقى في كوكي HttpOnly على المتصفح. يدعم تعدّد الأجهزة (عدة جلسات لعميل واحد)
// وتسجيل الخروج من جهاز واحد أو من جميع الأجهزة عبر revoked.
// ============================================

export const customerSessionType = defineType({
  name: "customerSession",
  title: "جلسات العملاء",
  type: "document",
  fields: [
    defineField({ name: "sessionId", title: "معرّف الجلسة", type: "string", readOnly: true }),
    defineField({
      name: "customerId",
      title: "معرّف العميل",
      type: "string",
      readOnly: true,
      description: "يربط الجلسة بالعميل. لا يُقبل إطلاقاً من بيانات العميل.",
    }),
    defineField({
      name: "tokenHash",
      title: "بصمة التوكن",
      type: "string",
      readOnly: true,
      description: "sha256 لتوكن الكوكي. التوكن الخام لا يُحفظ في قاعدة البيانات.",
    }),
    defineField({ name: "createdAt", title: "أُنشئت في", type: "datetime", readOnly: true }),
    defineField({ name: "expiresAt", title: "تنتهي في", type: "datetime", readOnly: true }),
    defineField({ name: "lastActivity", title: "آخر نشاط", type: "datetime", readOnly: true }),
    defineField({ name: "ip", title: "IP", type: "string", readOnly: true }),
    defineField({ name: "userAgent", title: "User Agent", type: "string", readOnly: true }),
    defineField({
      name: "revoked",
      title: "ملغاة",
      type: "boolean",
      readOnly: true,
      initialValue: false,
    }),
  ],
  orderings: [
    { title: "الأحدث أولاً", name: "createdAtDesc", by: [{ field: "createdAt", direction: "desc" }] },
  ],
  preview: {
    select: { customerId: "customerId", createdAt: "createdAt", revoked: "revoked" },
    prepare: ({ customerId, createdAt, revoked }) => ({
      title: customerId ?? "جلسة",
      subtitle: `${revoked ? "ملغاة" : "نشطة"} • ${createdAt ?? ""}`,
    }),
  },
})
