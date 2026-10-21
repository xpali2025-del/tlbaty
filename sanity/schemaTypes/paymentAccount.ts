import { defineField, defineType } from "sanity"
import { INITIAL_PAYMENT_PROVIDERS } from "@/lib/payment"

// ============================================
// حسابات الدفع (paymentAccount) — مشروع المحتوى
// كل مستند يمثّل حساباً واحداً لمزوّد دفع (خدمة حاسب / جيب / جوالي / قطبي / غيرها).
// يمكن إضافة أكثر من حساب للمزوّد نفسه، وتعطيل أي حساب دون حذفه.
// الحسابات المعطّلة لا تُعرض للعملاء إطلاقاً، لكنها تبقى موجودة للطلبات القديمة.
//
// ملاحظة مهمة: accountNumber من نوع string وليس number حتى لا تضيع
// الأصفار في بداية رقم الحساب (مثل 0771234567).
// ============================================



export const paymentAccountType = defineType({
  name: "paymentAccount",
  title: "حسابات الدفع",
  type: "document",
  fields: [
    defineField({
      name: "providerName",
      title: "مزوّد الدفع",
      type: "string",
      description: `اكتب اسم المزوّد. المزوّدون المتاحون حالياً: ${INITIAL_PAYMENT_PROVIDERS.join(
        " / ",
      )} — ويمكن إدخال اسم مزوّد جديد.`,
      validation: (rule) => rule.required().min(2).max(80).error("اسم مزوّد الدفع مطلوب"),
    }),
    defineField({
      name: "accountDisplayName",
      title: "الاسم الظاهر للحساب",
      type: "string",
      description: "اسم مختصر يميّز الحساب في القائمة، مثل «جوالي — الحساب الرئيسي».",
      validation: (rule) => rule.max(120),
    }),
    defineField({
      name: "accountHolderName",
      title: "اسم صاحب الحساب",
      type: "string",
      validation: (rule) => rule.required().min(3).max(120).error("اسم صاحب الحساب مطلوب"),
    }),
    defineField({
      name: "accountNumber",
      title: "رقم الحساب",
      type: "string",
      description: "يُحفظ كنص للحفاظ على الأصفار في البداية.",
      validation: (rule) => rule.required().min(3).max(60).error("رقم الحساب مطلوب"),
    }),
    defineField({
      name: "image",
      title: "صورة أو شعار الحساب",
      type: "image",
      description: "اختيارية — شعار المزوّد أو صورة توضيحية.",
      options: { hotspot: true },
    }),
    defineField({
      name: "instructions",
      title: "تعليمات الدفع (اختيارية)",
      type: "text",
      rows: 3,
      validation: (rule) => rule.max(600),
    }),
    defineField({
      name: "isActive",
      title: "الحساب مُفعّل",
      type: "boolean",
      description: "عند التعطيل يختفي الحساب من خيارات الدفع الجديدة ولا يتأثر أي طلب سابق.",
      initialValue: true,
    }),
    defineField({
      name: "sortOrder",
      title: "ترتيب الظهور",
      type: "number",
      initialValue: 0,
      validation: (rule) =>
        rule.integer().min(0).max(9999).error("الترتيب يجب أن يكون رقماً صحيحاً غير سالب"),
    }),
    defineField({ name: "createdAt", title: "تاريخ الإضافة", type: "datetime", readOnly: true }),
    defineField({ name: "updatedAt", title: "آخر تعديل", type: "datetime", readOnly: true }),
  ],
  orderings: [
    {
      title: "ترتيب الظهور",
      name: "sortOrderAsc",
      by: [
        { field: "sortOrder", direction: "asc" },
        { field: "providerName", direction: "asc" },
      ],
    },
  ],
  preview: {
    select: {
      provider: "providerName",
      display: "accountDisplayName",
      holder: "accountHolderName",
      number: "accountNumber",
      active: "isActive",
      media: "image",
    },
    prepare: ({ provider, display, holder, number, active, media }) => ({
      title: `${display || provider || "حساب دفع"}${active === false ? " (معطّل)" : ""}`,
      subtitle: `${holder ?? "-"} • ${number ?? "-"}`,
      media,
    }),
  },
})
