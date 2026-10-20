import { defineField, defineType } from "sanity"

export const reviewType = defineType({
  name: "review",
  title: "آراء العملاء",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "اسم العميل",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "rating",
      title: "التقييم",
      type: "number",
      validation: (rule) => rule.required().min(1).max(5),
    }),
    defineField({
      name: "comment",
      title: "التعليق",
      type: "text",
      rows: 3,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "date",
      title: "التاريخ",
      type: "date",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "avatar",
      title: "الصورة الشخصية",
      type: "image",
      options: { hotspot: true },
    }),
  ],
  preview: {
    select: { title: "name", subtitle: "comment", media: "avatar" },
  },
})
