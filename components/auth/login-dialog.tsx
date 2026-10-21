"use client"

import Link from "next/link"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { WhatsAppLogin } from "@/app/login/whatsapp/whatsapp-login"

/**
 * نافذة تسجيل دخول داخل الصفحة: تنتهي الجلسة أثناء الدفع فلا نُخرج العميل من صفحته (فيضيع الموقع المحدّد
 * وصورة الإثبات والملاحظة). يسجّل دخوله هنا ثم يُكمَل الطلب تلقائياً بنفس بياناته.
 */
export function LoginDialog({
  open,
  onClose,
  onLoggedIn,
  nextPath = "/checkout",
}: {
  open: boolean
  /** أُغلقت النافذة دون تسجيل دخول. */
  onClose: () => void
  onLoggedIn: () => void
  nextPath?: string
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>سجّل دخولك لإكمال الطلب</DialogTitle>
          <DialogDescription>
            انتهت جلستك. بياناتك وسلتك محفوظة، وسيُكمَل طلبك فور تسجيل الدخول.
          </DialogDescription>
        </DialogHeader>
        <WhatsAppLogin onSuccess={onLoggedIn} />
        <p className="text-xs text-muted-foreground">
          لا يعمل واتساب؟{" "}
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="text-primary underline">
            سجّل الدخول برسالة نصية
          </Link>{" "}
          (ستعود لإدخال بياناتك من جديد).
        </p>
      </DialogContent>
    </Dialog>
  )
}
