import { defineField, defineType } from "sanity"

// ============================================
// سجل تدقيق المصادقة — يسجّل كل العمليات الحساسة:
// إرسال/إعادة إرسال OTP، تحقق ناجح/فاشل، انتهاء صلاحية، إنشاء حساب،
// تسجيل دخول/خروج، تغيير رقم الهاتف.
// ============================================

export const authEventType = defineType({
  name: "authEvent",
  title: "سجل تدقيق المصادقة",
  type: "document",
  fields: [
    defineField({
      name: "event",
      title: "الحدث",
      type: "string",
      readOnly: true,
      options: {
        list: [
          { title: "إرسال رمز", value: "otp_sent" },
          { title: "إعادة إرسال رمز", value: "otp_resent" },
          { title: "تحقق ناجح", value: "otp_verified" },
          { title: "تحقق فاشل", value: "otp_failed" },
          { title: "انتهاء صلاحية", value: "otp_expired" },
          { title: "تجاوز الحد", value: "rate_limited" },
          { title: "إنشاء حساب", value: "account_created" },
          { title: "تسجيل دخول", value: "login" },
          { title: "تسجيل خروج", value: "logout" },
          { title: "خروج من كل الأجهزة", value: "logout_all" },
          { title: "تغيير رقم الهاتف", value: "phone_changed" },
        ],
      },
    }),
    defineField({ name: "phone", title: "رقم الهاتف", type: "string", readOnly: true }),
    defineField({ name: "customerId", title: "معرّف العميل", type: "string", readOnly: true }),
    defineField({ name: "ip", title: "IP", type: "string", readOnly: true }),
    defineField({ name: "userAgent", title: "User Agent", type: "string", readOnly: true }),
    defineField({ name: "detail", title: "تفاصيل", type: "string", readOnly: true }),
    defineField({ name: "at", title: "الوقت", type: "datetime", readOnly: true }),
  ],
  orderings: [
    { title: "الأحدث أولاً", name: "atDesc", by: [{ field: "at", direction: "desc" }] },
  ],
  preview: {
    select: { event: "event", phone: "phone", at: "at" },
    prepare: ({ event, phone, at }) => ({
      title: `${event ?? "?"} — ${phone ?? "-"}`,
      subtitle: at ?? "",
    }),
  },
})
