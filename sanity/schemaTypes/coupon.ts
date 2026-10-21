import { defineField, defineType } from "sanity"

export const couponType = defineType({
  name: "coupon",
  title: "أكواد الخصم",
  type: "document",
  fields: [
    defineField({
      name: "code",
      title: "كود الخصم",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "discount",
      title: "قيمة الخصم",
      type: "number",
      validation: (rule) => rule.required().min(0),
    }),
    defineField({
      name: "type",
      title: "نوع الخصم",
      type: "string",
      options: {
        list: [
          { title: "نسبة مئوية", value: "percent" },
          { title: "مبلغ ثابت", value: "fixed" },
        ],
        layout: "radio",
      },
      initialValue: "fixed",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "minOrder",
      title: "الحد الأدنى للطلب",
      type: "number",
      initialValue: 0,
      validation: (rule) => rule.min(0),
    }),
    defineField({
      name: "description",
      title: "الوصف",
      type: "string",
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: { title: "code", subtitle: "description" },
  },
})
