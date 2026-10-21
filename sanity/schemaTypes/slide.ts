import { defineField, defineType } from "sanity"

export const slideType = defineType({
  name: "slide",
  title: "سلايدر الصفحة الرئيسية",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "العنوان",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "subtitle",
      title: "العنوان الفرعي",
      type: "string",
    }),
    defineField({
      name: "cta",
      title: "نص الزر",
      type: "string",
    }),
    defineField({
      name: "href",
      title: "رابط الزر",
      type: "string",
      description: "مثل /category/women",
    }),
    defineField({
      name: "image",
      title: "صورة السلايد",
      type: "image",
      options: { hotspot: true },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "sortOrder",
      title: "ترتيب العرض",
      type: "number",
      initialValue: 0,
    }),
  ],
  preview: {
    select: { title: "title", subtitle: "href", media: "image" },
  },
})
