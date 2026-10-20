import { NextResponse } from "next/server"

import { getNotificationsSummary } from "@/lib/notifications"

// ============================================
// GET /api/notifications/summary
//
// استعلام خفيف جداً لعدّاد الجرس: يعيد المعرفات وأوقات النشر والأولوية فقط.
// لا صور ولا نصوص كاملة، فلا يثقل تحميل أي صفحة.
//
// المقارنة مع قائمة القراءة المحلية تحدث في المتصفح (لا حساب للعميل)،
// لذلك يكفي هنا إرجاع الإشعارات المنشورة الصالحة.
// ============================================

export async function GET() {
  try {
    const items = await getNotificationsSummary()

    return NextResponse.json(
      { items },
      {
        headers: {
          // كاش قصير على الحافة + إبطال فوري عبر revalidateTag عند النشر.
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    )
  } catch {
    // فشل مشروع الإشعارات لا يجوز أن يعطل الهيدر أو بقية الموقع.
    return NextResponse.json({ items: [] }, { status: 200 })
  }
}
