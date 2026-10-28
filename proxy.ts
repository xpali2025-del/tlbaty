import { NextResponse, type NextRequest } from "next/server"

// حاجز مبكر للوحة الإدارة: بلا كوكي جلسة يُوجَّه الزائر لصفحة الدخول بـ 307 حقيقي قبل رسم أي صفحة.
// التحقق الكامل من التوقيع والصلاحيات يبقى في getManageContext داخل كل صفحة وإجراء؛ هذا الحاجز لا يمنح دخولاً.
// لازم لأن التخطيط الجذري force-dynamic يبثّ الاستجابة فيصير redirect() داخل الصفحة 200 مع إعادة توجيه في HTML.

const COOKIE_NAME = "manage_session"

/** بلا كلمة مرور خارج الإنتاج تكون اللوحة مفتوحة للتطوير (نفس قاعدة lib/manage-auth). */
function devOpen(): boolean {
  return !process.env.MANAGE_PASSWORD?.trim() && process.env.NODE_ENV !== "production"
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname === "/manage/login" || pathname.startsWith("/manage/login/")) return NextResponse.next()
  if (request.cookies.get(COOKIE_NAME)?.value || devOpen()) return NextResponse.next()
  return NextResponse.redirect(new URL("/manage/login", request.url))
}

export const config = {
  matcher: ["/manage", "/manage/:path*"],
}
