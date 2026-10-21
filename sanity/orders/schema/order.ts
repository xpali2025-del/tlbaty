import { defineArrayMember, defineField, defineType } from "sanity"

// ============================================
// مخطط الطلب — يُعرض في استوديو الطلبات (/studio-orders)
// ============================================

export const orderType = defineType({
  name: "order",
  title: "الطلبات",
  type: "document",
  fields: [
    defineField({
      name: "orderNumber",
      title: "رقم الطلب",
      type: "string",
      readOnly: true,
    }),
    defineField({
      name: "status",
      title: "حالة الطلب",
      type: "string",
      initialValue: "new",
      description:
        "حالة التنفيذ والتوصيل — مستقلة تماماً عن حالة الدفع (paymentStatus). الطلبات القديمة قد تحمل shipped أو completed وتُترجم تلقائياً في اللوحة.",
      options: {
        list: [
          { title: "طلب جديد", value: "new" },
          { title: "تم تأكيد الطلب", value: "confirmed" },
          { title: "قيد التجهيز", value: "processing" },
          { title: "جاهز للتوصيل", value: "ready" },
          { title: "تم تعيين مندوب", value: "assigned" },
          { title: "في الطريق", value: "on_the_way" },
          { title: "تم التسليم", value: "delivered" },
          { title: "تعذر التسليم", value: "failed" },
          { title: "ملغي", value: "cancelled" },
          { title: "مرتجع", value: "returned" },
        ],
      },
    }),
    // حقول التتبع — يُنشئها الخادم وحده عند إنشاء الطلب.
    // اختيارية في المخطط حتى لا تُكسر الطلبات القديمة، لكن API إنشاء
    // الطلب يفرضها إلزامياً على كل طلب جديد.
    defineField({
      name: "customerId",
      title: "معرّف العميل الداخلي",
      type: "string",
      readOnly: true,
      description:
        "بصمة HMAC مشتقة من رقم الهاتف المحلي. تربط كل طلبات الهاتف نفسه وتُستخدم في مطابقة التتبع وعدّ العملاء. لا تُعرض للعميل إطلاقاً.",
    }),
    defineField({
      name: "customerPhoneNormalized",
      title: "رقم هاتف العميل المحلي",
      type: "string",
      readOnly: true,
      description:
        "الرقم المحلي الموحّد (9 أرقام بلا كود دولة) كما أنشأه الخادم، يُستخدم في مطابقة التتبع.",
    }),
    defineField({ name: "customerName", title: "اسم العميل", type: "string" }),
    defineField({ name: "phone", title: "رقم الهاتف", type: "string" }),
    defineField({ name: "city", title: "المدينة", type: "string" }),
    defineField({ name: "address", title: "العنوان التفصيلي", type: "text", rows: 2 }),
    defineField({
      name: "customerLocation",
      title: "موقع العميل",
      type: "geopoint",
      description: "إحداثيات موقع التوصيل الفعلي التي حددها العميل وقت الطلب.",
    }),
    defineField({ name: "locationAccuracy", title: "دقة الموقع (متر)", type: "number" }),
    defineField({ name: "locationCapturedAt", title: "وقت تحديد الموقع", type: "datetime" }),
    defineField({
      name: "addressSource",
      title: "مصدر العنوان",
      type: "string",
      options: {
        list: [
          { title: "عنوان محفوظ", value: "عنوان محفوظ" },
          { title: "عنوان جديد", value: "عنوان جديد" },
        ],
      },
    }),
    defineField({
      name: "items",
      title: "المنتجات",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "orderItem",
          fields: [
            defineField({ name: "productId", title: "معرّف المنتج", type: "string" }),
            // لقطة ثابتة وقت الطلب — لا تتغير إذا عُدّل المنتج أو حُذف لاحقاً.
            defineField({
              name: "productNumber",
              title: "رقم المنتج",
              type: "string",
              readOnly: true,
              description: "رقم تلقائي مشتق من معرّف المنتج، محفوظ كلقطة وقت الطلب.",
            }),
            defineField({
              name: "sku",
              title: "رقم الصنف SKU",
              type: "string",
              readOnly: true,
              description: "رقم الصنف الخارجي إن كان مسجلاً على المنتج.",
            }),
            defineField({
              name: "image",
              title: "صورة المنتج",
              type: "url",
              readOnly: true,
              description: "رابط صورة المنتج وقت الطلب.",
            }),
            defineField({ name: "name", title: "الاسم", type: "string" }),
            defineField({ name: "size", title: "المقاس", type: "string" }),
            defineField({ name: "color", title: "اللون", type: "string" }),
            defineField({ name: "quantity", title: "الكمية", type: "number" }),
            defineField({ name: "price", title: "سعر الوحدة", type: "number" }),
            defineField({ name: "lineTotal", title: "إجمالي السطر", type: "number" }),
          ],
          preview: {
            select: {
              title: "name",
              size: "size",
              color: "color",
              quantity: "quantity",
              productNumber: "productNumber",
            },
            prepare: ({ title, size, color, quantity, productNumber }) => ({
              title: `${productNumber ? `${productNumber} — ` : ""}${title ?? "منتج"}`,
              subtitle: `المقاس: ${size ?? "-"} | اللون: ${color ?? "-"} | الكمية: ${quantity ?? "-"}`,
            }),
          },
        }),
      ],
    }),
    // ملاحظة العميل — نص عادي اختياري (لا يوجد أي حقل صوتي: التسجيل غير محفوظ إطلاقاً).
    defineField({
      name: "customerNote",
      title: "ملاحظة العميل",
      type: "text",
      rows: 4,
      description: "ملاحظة اختيارية كتبها العميل أو أدخلها بالتحويل من الصوت إلى نص.",
    }),
    defineField({ name: "shippingMethod", title: "طريقة التوصيل", type: "string" }),
    defineField({ name: "shippingPrice", title: "رسوم الشحن", type: "number" }),
    defineField({ name: "couponCode", title: "كود الخصم", type: "string" }),
    defineField({ name: "discount", title: "قيمة الخصم", type: "number" }),
    defineField({ name: "subtotal", title: "إجمالي المنتجات", type: "number" }),
    defineField({ name: "total", title: "الإجمالي النهائي", type: "number" }),
    defineField({ name: "currency", title: "العملة", type: "string" }),
    defineField({ name: "currencyCode", title: "رمز العملة", type: "string" }),
    defineField({
      name: "createdAt",
      title: "تاريخ الطلب",
      type: "datetime",
      readOnly: true,
    }),

    // ============================================
    // التوصيل — المندوب وسجل الحالات.
    // كل الحقول اختيارية حتى تبقى الطلبات القديمة تعمل بلا مندوب أو سجل.
    // ============================================
    defineField({
      name: "courier",
      title: "مندوب التوصيل",
      type: "reference",
      to: [{ type: "courier" }],
      description: "مرجع المندوب. لا يُغيّر حالة الطلب تلقائياً.",
    }),
    defineField({
      name: "courierSnapshot",
      title: "نسخة ثابتة من بيانات المندوب",
      type: "object",
      readOnly: true,
      description: "تحفظ الاسم والهاتف وقت التعيين حتى لا تتأثر الطلبات القديمة بأي تعديل لاحق.",
      fields: [
        defineField({ name: "courierId", title: "معرّف المندوب", type: "string" }),
        defineField({ name: "name", title: "اسم المندوب", type: "string" }),
        defineField({ name: "phone", title: "رقم هاتف المندوب", type: "string" }),
      ],
    }),
    defineField({
      name: "courierAssignedAt",
      title: "وقت تعيين المندوب",
      type: "datetime",
      readOnly: true,
    }),
    defineField({
      name: "deliveredAt",
      title: "وقت التسليم",
      type: "datetime",
      readOnly: true,
    }),
    defineField({
      name: "statusHistory",
      title: "سجل تغييرات حالة الطلب",
      type: "array",
      readOnly: true,
      of: [
        defineArrayMember({
          type: "object",
          name: "orderStatusChange",
          fields: [
            defineField({ name: "from", title: "الحالة السابقة", type: "string" }),
            defineField({ name: "to", title: "الحالة الجديدة", type: "string" }),
            defineField({ name: "changedAt", title: "وقت التغيير", type: "datetime" }),
            defineField({ name: "changedBy", title: "بواسطة", type: "string" }),
            defineField({ name: "note", title: "ملاحظة", type: "text", rows: 2 }),
          ],
          preview: {
            select: { from: "from", to: "to", changedAt: "changedAt", changedBy: "changedBy" },
            prepare: ({ from, to, changedAt, changedBy }) => ({
              title: `${from ?? "-"} ← ${to ?? "-"}`,
              subtitle: `${changedBy ?? "-"} • ${changedAt ?? "-"}`,
            }),
          },
        }),
      ],
    }),

    // ============================================
    // الدفع — حقول مستقلة تماماً عن حالة الطلب (status)
    // كل الحقول اختيارية حتى لا تُكسر الطلبات القديمة.
    // ============================================
    defineField({
      name: "paymentMethod",
      title: "طريقة الدفع",
      type: "string",
      readOnly: true,
      options: {
        list: [
          { title: "الدفع عند الاستلام", value: "cash_on_delivery" },
          { title: "تحويل يدوي إلى حساب دفع", value: "manual_transfer" },
        ],
        layout: "radio",
      },
    }),
    defineField({
      name: "paymentStatus",
      title: "حالة الدفع",
      type: "string",
      description: "حالة التحقق من الدفع — مستقلة عن حالة الطلب.",
      options: {
        list: [
          { title: "الدفع عند الاستلام", value: "pending_on_delivery" },
          { title: "جارٍ التحقق من الدفع", value: "pending_verification" },
          { title: "تم التحقق من الدفع", value: "verified" },
          { title: "تعذّر التحقق من الدفع", value: "rejected" },
          { title: "تم الدفع", value: "paid" },
          { title: "تمت إعادة المبلغ", value: "refunded" },
          { title: "دفع ملغي", value: "cancelled" },
        ],
      },
    }),
    defineField({
      name: "paymentAccountSnapshot",
      title: "نسخة ثابتة من حساب الدفع",
      type: "object",
      readOnly: true,
      description:
        "نسخة محفوظة وقت الطلب — لا تتغير إذا عُدّل الحساب أو حُذف لاحقاً في مشروع المحتوى.",
      fields: [
        defineField({ name: "sourceDocumentId", title: "معرّف المستند الأصلي", type: "string" }),
        defineField({ name: "providerName", title: "مزوّد الدفع", type: "string" }),
        defineField({ name: "accountDisplayName", title: "الاسم الظاهر للحساب", type: "string" }),
        defineField({ name: "accountHolderName", title: "اسم صاحب الحساب", type: "string" }),
        defineField({ name: "accountNumber", title: "رقم الحساب", type: "string" }),
        defineField({ name: "imageUrl", title: "شعار الحساب", type: "url" }),
      ],
    }),
    defineField({
      name: "transferSenderName",
      title: "اسم مرسل الحوالة",
      type: "string",
      readOnly: true,
    }),
    defineField({
      name: "transferReference",
      title: "رقم الحوالة",
      type: "string",
      readOnly: true,
      description: "نص وليس رقماً — للحفاظ على الأصفار في بداية الرقم.",
    }),
    defineField({
      name: "transferSubmittedAt",
      title: "وقت إرسال بيانات الحوالة",
      type: "datetime",
      readOnly: true,
    }),
    defineField({
      name: "paymentProof",
      title: "إثبات الحوالة (مشفّر)",
      type: "object",
      readOnly: true,
      description:
        "ملف مشفّر بـ AES-256-GCM. لا يمكن فتحه من رابط CDN — يُعرض فقط عبر مسار الإدارة المحمي.",
      fields: [
        defineField({
          name: "asset",
          title: "الملف المشفّر",
          type: "file",
        }),
        defineField({ name: "iv", title: "IV", type: "string" }),
        defineField({ name: "authTag", title: "Authentication Tag", type: "string" }),
        defineField({ name: "keyVersion", title: "إصدار المفتاح", type: "string" }),
        defineField({ name: "originalMimeType", title: "نوع الصورة الأصلي", type: "string" }),
        defineField({ name: "processedMimeType", title: "نوع الصورة بعد المعالجة", type: "string" }),
        defineField({ name: "byteSize", title: "الحجم بعد المعالجة", type: "number" }),
        defineField({ name: "uploadedAt", title: "وقت الرفع", type: "datetime" }),
      ],
    }),
    defineField({ name: "paymentVerifiedAt", title: "وقت التحقق من الدفع", type: "datetime" }),
    defineField({ name: "paymentRejectedAt", title: "وقت رفض الإثبات", type: "datetime" }),
    defineField({ name: "paymentRejectionReason", title: "سبب الرفض", type: "text", rows: 2 }),
    defineField({ name: "paymentAdminNote", title: "ملاحظات الإدارة على الدفع", type: "text", rows: 2 }),
    defineField({
      name: "duplicateTransferReference",
      title: "رقم الحوالة مستخدم في طلب آخر",
      type: "boolean",
      readOnly: true,
      description: "يُرفع تلقائياً عند اكتشاف تكرار رقم الحوالة — يحتاج مراجعة إدارية.",
    }),
    defineField({
      name: "paymentStatusHistory",
      title: "سجل تغييرات حالة الدفع",
      type: "array",
      readOnly: true,
      of: [
        defineArrayMember({
          type: "object",
          name: "paymentStatusChange",
          fields: [
            defineField({ name: "status", title: "الحالة", type: "string" }),
            defineField({ name: "changedAt", title: "وقت التغيير", type: "datetime" }),
            defineField({ name: "changedBy", title: "بواسطة", type: "string" }),
            defineField({ name: "note", title: "ملاحظة", type: "text", rows: 2 }),
          ],
          preview: {
            select: { status: "status", changedAt: "changedAt", changedBy: "changedBy" },
            prepare: ({ status, changedAt, changedBy }) => ({
              title: (status as string) ?? "-",
              subtitle: `${changedBy ?? "-"} • ${changedAt ?? "-"}`,
            }),
          },
        }),
      ],
    }),
  ],
  orderings: [
    {
      title: "الأحدث أولاً",
      name: "createdAtDesc",
      by: [{ field: "createdAt", direction: "desc" }],
    },
  ],
  preview: {
    select: {
      name: "customerName",
      total: "total",
      currency: "currency",
      status: "status",
      orderNumber: "orderNumber",
    },
    prepare: ({ name, total, currency, status, orderNumber }) => {
      // يشمل الحالات الجديدة والقيم القديمة (shipped/completed) معاً.
      const statusMap: Record<string, string> = {
        new: "طلب جديد",
        confirmed: "تم تأكيد الطلب",
        processing: "قيد التجهيز",
        ready: "جاهز للتوصيل",
        assigned: "تم تعيين مندوب",
        on_the_way: "في الطريق",
        delivered: "تم التسليم",
        failed: "تعذر التسليم",
        cancelled: "ملغي",
        returned: "مرتجع",
        shipped: "في الطريق",
        completed: "تم التسليم",
      }
      return {
        title: `${name ?? "عميل"} — ${total ?? 0}${currency ?? ""}`,
        subtitle: `${orderNumber ?? ""} • ${statusMap[status as string] ?? status ?? ""}`,
      }
    },
  },
})
