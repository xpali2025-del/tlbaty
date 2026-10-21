import { defineArrayMember, defineField, defineType } from "sanity"

/**
 * إعدادات الموقع (مستند واحد Singleton).
 * ملاحظة: الإعدادات الحرجة للسيو تبقى ثابتة في lib/site.ts
 * ويمكن ربط هذا المستند بالواجهة مستقبلاً عند الحاجة.
 */
export const settingsType = defineType({
  name: "siteSettings",
  title: "إعدادات الموقع",
  type: "document",
  groups: [
    { name: "general", title: "عام", default: true },
    { name: "currency", title: "العملات وأسعار الصرف" },
    { name: "contact", title: "التواصل" },
    { name: "navigation", title: "التنقل" },
    { name: "footer", title: "الفوتر" },
  ],
  fields: [
    defineField({ name: "name", title: "اسم المتجر", type: "string", group: "general" }),
    defineField({ name: "tagline", title: "الشعار النصي", type: "string", group: "general" }),
    defineField({ name: "description", title: "وصف المتجر", type: "text", rows: 3, group: "general" }),
    defineField({ name: "logo", title: "الشعار", type: "image", group: "general" }),
    // ============================================
    // العملات وأسعار الصرف
    // أسعار المنتجات مخزّنة بالعملة الأساسية (الريال اليمني القديم).
    // ============================================
    defineField({
      name: "currencies",
      title: "العملات المتاحة",
      description:
        "العملات التي يمكن للعميل الاختيار بينها. أسعار المنتجات مخزّنة بالريال اليمني القديم (العملة الأساسية، سعر صرفها = 1).",
      type: "array",
      group: "currency",
      of: [
        defineArrayMember({
          type: "object",
          name: "currency",
          fields: [
            defineField({
              name: "code",
              title: "الرمز المختصر (بالإنجليزية)",
              type: "string",
              description: "معرّف فريد لا يظهر للعميل، مثل: YER أو YER_NEW أو SAR",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "name",
              title: "اسم العملة",
              type: "string",
              description: "الاسم الذي يظهر للعميل في قائمة اختيار العملة",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "symbol",
              title: "الرمز المعروض بجانب السعر",
              type: "string",
              description: "مثل: ر.ي أو ر.ي.ج أو ر.س",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "rate",
              title: "سعر الصرف",
              type: "number",
              description:
                "كم يساوي 1 من هذه العملة بالريال اليمني القديم (العملة الأساسية). العملة الأساسية = 1، الريال السعودي = 140، الريال اليمني الجديد ≈ 0.357 (لأن 140 قديم = 392 جديد).",
              validation: (rule) => rule.required().positive(),
            }),
          ],
          preview: {
            select: { title: "name", code: "code", rate: "rate", symbol: "symbol" },
            prepare: ({ title, code, rate, symbol }) => ({
              title: `${title ?? code} (${symbol ?? ""})`,
              subtitle: `1 ${symbol ?? code} = ${rate ?? 1} ريال يمني قديم`,
            }),
          },
        }),
      ],
      initialValue: [
        { _type: "currency", code: "YER", name: "ريال يمني (قديم)", symbol: "ر.ي", rate: 1 },
        { _type: "currency", code: "YER_NEW", name: "ريال يمني (جديد)", symbol: "ر.ي.ج", rate: 0.3571428571 },
        { _type: "currency", code: "SAR", name: "ريال سعودي", symbol: "ر.س", rate: 140 },
      ],
    }),
    defineField({
      name: "defaultCurrency",
      title: "العملة الافتراضية",
      type: "string",
      group: "currency",
      description: "الرمز المختصر للعملة التي تُعرض للعميل افتراضياً قبل أن يختار عملة أخرى (مثل: YER).",
      initialValue: "YER",
    }),
    defineField({ name: "phone", title: "الهاتف", type: "string", group: "contact" }),
    defineField({ name: "whatsapp", title: "واتساب", type: "string", group: "contact" }),
    defineField({ name: "email", title: "البريد الإلكتروني", type: "string", group: "contact" }),
    defineField({ name: "address", title: "العنوان", type: "string", group: "contact" }),
    defineField({ name: "workingHours", title: "ساعات العمل", type: "string", group: "contact" }),
    defineField({
      name: "social",
      title: "روابط التواصل الاجتماعي",
      type: "object",
      group: "contact",
      fields: [
        defineField({ name: "instagram", title: "إنستغرام", type: "url" }),
        defineField({ name: "facebook", title: "فيسبوك", type: "url" }),
        defineField({ name: "tiktok", title: "تيك توك", type: "url" }),
      ],
    }),
    defineField({
      name: "navLinks",
      title: "روابط القائمة الرئيسية",
      type: "array",
      group: "navigation",
      of: [
        defineArrayMember({
          type: "object",
          name: "navLink",
          fields: [
            defineField({ name: "label", title: "النص", type: "string", validation: (rule) => rule.required() }),
            defineField({ name: "href", title: "الرابط", type: "string", validation: (rule) => rule.required() }),
          ],
          preview: { select: { title: "label", subtitle: "href" } },
        }),
      ],
    }),
    defineField({
      name: "footerLinks",
      title: "روابط الفوتر",
      type: "array",
      group: "footer",
      of: [
        defineArrayMember({
          type: "object",
          name: "footerLink",
          fields: [
            defineField({ name: "label", title: "النص", type: "string", validation: (rule) => rule.required() }),
            defineField({ name: "href", title: "الرابط", type: "string", validation: (rule) => rule.required() }),
          ],
          preview: { select: { title: "label", subtitle: "href" } },
        }),
      ],
    }),
    defineField({ name: "copyright", title: "نص الحقوق", type: "string", group: "footer" }),
  ],
  preview: {
    select: { title: "name" },
    prepare({ title }) {
      return { title: title ?? "إعدادات الموقع" }
    },
  },
})
