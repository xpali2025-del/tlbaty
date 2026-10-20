import { defineArrayMember, defineField, defineType } from "sanity"
import { YEMEN_GOVERNORATES } from "@/lib/yemen-governorates"

// ============================================
// طرق التوصيل حسب المحافظة (Shipping Zones)
// كل مستند يمثّل محافظة (أو الإعداد الافتراضي لباقي المحافظات)
// ويحتوي قائمة بطرق التوصيل الخاصة بها. تُدار بالكامل من الاستوديو:
// إضافة / تعديل / حذف الطرق والمحافظات دون لمس الكود.
// ============================================

export const shippingZoneType = defineType({
  name: "shippingZone",
  title: "طرق التوصيل حسب المحافظة",
  type: "document",
  fields: [
    defineField({
      name: "isDefault",
      title: "الإعداد الافتراضي (باقي المحافظات)",
      description:
        "فعّل هذا الخيار لمستند واحد فقط. يُستخدم لكل محافظة لا يوجد لها إعداد خاص.",
      type: "boolean",
      initialValue: false,
    }),
    defineField({
      name: "governorate",
      title: "المحافظة",
      type: "string",
      options: {
        list: YEMEN_GOVERNORATES.map((g) => ({ title: g, value: g })),
      },
      hidden: ({ parent }) => Boolean(parent?.isDefault),
      validation: (rule) =>
        rule.custom((value, context) => {
          const parent = context.parent as { isDefault?: boolean } | undefined
          if (parent?.isDefault) return true
          return value ? true : "اختر المحافظة أو فعّل الإعداد الافتراضي"
        }),
    }),
    defineField({
      name: "methods",
      title: "طرق التوصيل",
      type: "array",
      validation: (rule) => rule.required().min(1).error("أضف طريقة توصيل واحدة على الأقل"),
      of: [
        defineArrayMember({
          type: "object",
          name: "shippingMethod",
          title: "طريقة توصيل",
          fields: [
            defineField({
              name: "name",
              title: "الاسم",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "description",
              title: "الوصف",
              type: "string",
            }),
            defineField({
              name: "price",
              title: "السعر",
              description: "اكتب 0 للتوصيل المجاني",
              type: "number",
              initialValue: 0,
              validation: (rule) => rule.required().min(0),
            }),
            defineField({
              name: "icon",
              title: "الأيقونة",
              type: "string",
              options: {
                list: [
                  { title: "شحن سريع", value: "express" },
                  { title: "شحن عادي", value: "standard" },
                  { title: "استلام من المتجر", value: "pickup" },
                ],
                layout: "radio",
              },
              initialValue: "standard",
            }),
          ],
          preview: {
            select: { title: "name", subtitle: "description", price: "price" },
            prepare({ title, subtitle, price }) {
              return {
                title: title || "طريقة توصيل",
                subtitle:
                  (subtitle ? `${subtitle} — ` : "") +
                  (price ? `${price}` : "مجاناً"),
              }
            },
          },
        }),
      ],
    }),
  ],
  preview: {
    select: { governorate: "governorate", isDefault: "isDefault", methods: "methods" },
    prepare({ governorate, isDefault, methods }) {
      const count = Array.isArray(methods) ? methods.length : 0
      return {
        title: isDefault ? "باقي المحافظات (افتراضي)" : governorate || "محافظة",
        subtitle: `${count} طريقة توصيل`,
      }
    },
  },
})
