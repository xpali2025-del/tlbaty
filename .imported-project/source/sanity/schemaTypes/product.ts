import { defineArrayMember, defineField, defineType } from "sanity"
import { apiVersion } from "@/sanity/env"
import { AutoProductIdInput } from "@/sanity/components/AutoProductIdInput"
import { AutoSlugInput } from "@/sanity/components/AutoSlugInput"
import { DiscountPriceInput } from "@/sanity/components/DiscountPriceInput"
import { OptionalBrandInput } from "@/sanity/components/OptionalBrandInput"
import { SubcategoryInput } from "@/sanity/components/SubcategoryInput"

type ProductParent = {
  price?: number
  category?: { _ref?: string }
}

export const productType = defineType({
  name: "product",
  title: "المنتجات",
  type: "document",
  groups: [
    { name: "content", title: "البيانات الأساسية", default: true },
    { name: "media", title: "الصور" },
    { name: "options", title: "الخيارات والبيانات الإضافية" },
    { name: "seo", title: "SEO (اختياري)" },
  ],
  fieldsets: [
    {
      name: "advanced",
      title: "إعدادات متقدمة — لا تحتاجها عند الإدخال السريع",
      options: { collapsible: true, collapsed: true },
    },
  ],
  fields: [
    defineField({
      name: "category",
      title: "1. القسم الرئيسي",
      type: "reference",
      to: [{ type: "category" }],
      options: { disableNew: true },
      description: "اختر القسم أولاً، وستظهر الأقسام الفرعية التابعة له في الحقل التالي.",
      validation: (rule) => rule.required(),
      group: "content",
    }),
    defineField({
      name: "subcategory",
      title: "2. القسم الفرعي",
      type: "string",
      description: "تتغير هذه القائمة تلقائياً حسب القسم الرئيسي المختار.",
      components: { input: SubcategoryInput },
      validation: (rule) =>
        rule.custom(async (value, context) => {
          const categoryId = (context.parent as ProductParent | undefined)?.category?._ref
          if (!categoryId) return true

          try {
            const subcategoryCount = await context
              .getClient({ apiVersion })
              .fetch<number>(
                `count(*[_type == "category" && _id == $categoryId][0].subcategories)`,
                { categoryId },
              )
            return subcategoryCount === 0 || value ? true : "اختر القسم الفرعي لهذا المنتج"
          } catch {
            return true
          }
        }),
      group: "content",
    }),
    defineField({
      name: "productId",
      title: "3. رقم المنتج",
      type: "string",
      description: "يُنشأ تلقائياً بعد اختيار القسم والقسم الفرعي؛ لا تحتاج إلى كتابته.",
      components: { input: AutoProductIdInput },
      validation: (rule) => rule.required(),
      group: "content",
    }),
    defineField({
      name: "name",
      title: "4. اسم المنتج",
      type: "string",
      description: "اكتب الاسم كما تريد أن يظهر للعميل في المتجر.",
      validation: (rule) => rule.required().min(2),
      group: "content",
    }),
    defineField({
      name: "slug",
      title: "رابط المنتج — تلقائي",
      type: "slug",
      description: "يُنشأ تلقائياً من اسم المنتج، ويمكن تعديله عند الحاجة.",
      options: { source: "name", maxLength: 96 },
      components: { input: AutoSlugInput },
      validation: (rule) => rule.required(),
      group: "content",
    }),
    defineField({
      name: "price",
      title: "5. السعر الحالي",
      type: "number",
      description: "السعر الذي سيدفعه العميل.",
      validation: (rule) => rule.required().min(0),
      group: "content",
    }),
    defineField({
      name: "oldPrice",
      title: "السعر قبل الخصم (اختياري)",
      type: "number",
      description: "إذا أدخلته سيُحسب الخصم ويظهر المنتج تلقائياً ضمن العروض.",
      components: { input: DiscountPriceInput },
      validation: (rule) =>
        rule.min(0).custom((value, context) => {
          if (value === undefined || value === null) return true
          const price = (context.parent as ProductParent | undefined)?.price
          if (typeof price !== "number") return "أدخل السعر الحالي أولاً"
          return value > price || "يجب أن يكون السعر قبل الخصم أعلى من السعر الحالي"
        }),
      group: "content",
    }),
    defineField({
      name: "description",
      title: "6. وصف المنتج",
      type: "text",
      rows: 4,
      description: "اذكر أهم مواصفات المنتج وفوائده باختصار.",
      validation: (rule) => rule.required().min(10),
      group: "content",
    }),
    defineField({
      name: "brand",
      title: "هل المنتج تابع لبراند؟",
      type: "reference",
      to: [{ type: "brand" }],
      options: { disableNew: true },
      description: "اختر «بدون براند» أو حدّد البراند من القائمة.",
      components: { input: OptionalBrandInput },
      group: "content",
    }),
    defineField({
      name: "isNew",
      title: "إظهار ضمن المنتجات الحديثة",
      type: "boolean",
      description: "فعّله إذا أردت ظهور المنتج في قسم المنتجات الحديثة.",
      initialValue: false,
      group: "content",
    }),
    defineField({
      name: "isBestseller",
      title: "إظهار ضمن الأكثر مبيعاً",
      type: "boolean",
      description: "فعّله إذا أردت ظهور المنتج في قسم الأكثر مبيعاً.",
      initialValue: false,
      group: "content",
    }),
    defineField({
      name: "mainImage",
      title: "الصورة الرئيسية",
      type: "image",
      description: "هذه أول صورة تظهر في بطاقة المنتج وصفحته.",
      options: { hotspot: true },
      group: "media",
    }),
    defineField({
      name: "images",
      title: "صور إضافية للمنتج",
      type: "array",
      description: "اختياري — أضف صوراً من زوايا مختلفة.",
      of: [defineArrayMember({ type: "image", options: { hotspot: true } })],
      group: "media",
    }),
    defineField({
      name: "stock",
      title: "الكمية المتوفرة",
      type: "number",
      description: "اتركها صفر إذا كان المنتج غير متوفر حالياً.",
      initialValue: 0,
      validation: (rule) => rule.min(0),
      group: "options",
    }),
    defineField({
      name: "colors",
      title: "الألوان (اختياري)",
      type: "array",
      description: "اتركها فارغة إذا لم يكن للمنتج ألوان متعددة.",
      of: [
        defineArrayMember({
          type: "object",
          name: "colorOption",
          fields: [
            defineField({
              name: "name",
              title: "اسم اللون",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "hex",
              title: "كود اللون",
              type: "string",
              description: "مثال: #000000 للأسود",
              validation: (rule) =>
                rule.required().regex(/^#[0-9a-fA-F]{6}$/, { name: "hex", invert: false }),
            }),
          ],
          preview: { select: { title: "name", subtitle: "hex" } },
        }),
      ],
      group: "options",
    }),
    defineField({
      name: "sizes",
      title: "المقاسات (اختياري)",
      type: "array",
      description: "اتركها فارغة إذا لم يكن للمنتج مقاسات.",
      of: [defineArrayMember({ type: "string" })],
      options: { layout: "tags" },
      group: "options",
    }),
    defineField({
      name: "sku",
      title: "رقم الصنف الخارجي SKU (اختياري)",
      type: "string",
      description: "اتركه فارغاً لاستخدام رقم المنتج التلقائي.",
      fieldset: "advanced",
      group: "options",
    }),
    defineField({
      name: "badge",
      title: "شارة قصيرة (اختياري)",
      type: "string",
      description: "مثال: حصري، كمية محدودة.",
      fieldset: "advanced",
      group: "options",
    }),
    defineField({
      name: "sortOrder",
      title: "ترتيب العرض",
      type: "number",
      description: "الأرقام الأصغر تظهر أولاً. اتركه صفر للترتيب العادي.",
      initialValue: 0,
      fieldset: "advanced",
      group: "options",
    }),
    defineField({
      name: "rating",
      title: "التقييم",
      type: "number",
      initialValue: 5,
      validation: (rule) => rule.min(0).max(5),
      fieldset: "advanced",
      group: "options",
    }),
    defineField({
      name: "reviewsCount",
      title: "عدد التقييمات",
      type: "number",
      initialValue: 0,
      validation: (rule) => rule.min(0),
      fieldset: "advanced",
      group: "options",
    }),
    defineField({
      name: "metaTitle",
      title: "عنوان صفحة البحث (اختياري)",
      type: "string",
      description: "اتركه فارغاً لاستخدام اسم المنتج تلقائياً.",
      validation: (rule) => rule.max(70).warning("يفضل ألا يتجاوز العنوان 70 حرفاً"),
      group: "seo",
    }),
    defineField({
      name: "metaDescription",
      title: "وصف صفحة البحث (اختياري)",
      type: "text",
      rows: 3,
      description: "اتركه فارغاً لاستخدام وصف المنتج تلقائياً.",
      validation: (rule) => rule.max(170).warning("يفضل ألا يتجاوز الوصف 170 حرفاً"),
      group: "seo",
    }),
    defineField({
      name: "keywords",
      title: "الكلمات المفتاحية (اختياري)",
      type: "array",
      description: "اكتب الكلمة ثم اضغط Enter، أو اترك الحقل فارغاً.",
      of: [defineArrayMember({ type: "string" })],
      options: { layout: "tags" },
      group: "seo",
    }),
  ],
  preview: {
    select: {
      title: "name",
      productId: "productId",
      price: "price",
      oldPrice: "oldPrice",
      media: "mainImage",
    },
    prepare({ title, productId, price, oldPrice, media }) {
      const offer = typeof oldPrice === "number" && oldPrice > price ? " • عرض" : ""
      return {
        title: title || "منتج بدون اسم",
        subtitle: `${productId || "لم يُنشأ الرقم"}${offer}`,
        media,
      }
    },
  },
})
