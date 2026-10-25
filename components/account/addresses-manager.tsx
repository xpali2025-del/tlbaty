"use client"

import { useState } from "react"
import { Briefcase, ExternalLink, Home, Loader2, MapPin, MapPinned, Pencil, Plus, Trash2 } from "lucide-react"
import { AddressForm } from "@/components/account/address-form"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useToast } from "@/hooks/use-toast"
import { isValidCoords, MAX_SAVED_ADDRESSES, useSavedAddresses, type SavedAddress } from "@/hooks/use-saved-addresses"

const LABEL_ICON: Record<string, typeof MapPin> = { المنزل: Home, العمل: Briefcase }

/** عناويني: قائمة العناوين المحفوظة مع التسمية، وإضافة/تعديل/حذف. التخزين محلي ويتزامن مع الحساب تلقائياً. */
export function AddressesManager() {
  const { addresses, hydrated, addAddress, updateAddress, removeAddress } = useSavedAddresses()
  const { toast } = useToast()
  const [formFor, setFormFor] = useState<SavedAddress | "new" | null>(null)
  const [deleting, setDeleting] = useState<SavedAddress | null>(null)

  const full = addresses.length >= MAX_SAVED_ADDRESSES

  if (!hydrated) {
    return (
      <div className="flex items-center gap-2 py-10 text-muted-foreground" aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <span className="text-sm">جارٍ تحميل عناوينك...</span>
      </div>
    )
  }

  return (
    <div>
      {addresses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <MapPinned className="h-7 w-7 text-primary" aria-hidden="true" />
          </span>
          <p className="font-bold">لا توجد عناوين محفوظة</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">احفظ عنوان المنزل أو العمل مرة واحدة، واختره بنقرة عند إتمام أي طلب دون تحديد موقعك من جديد.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {addresses.map((a) => {
            const Icon = LABEL_ICON[a.label ?? ""] ?? MapPin
            const validLocation = isValidCoords(a.latitude, a.longitude)
            return (
              <li key={a.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                    <p className="font-bold">{a.label ?? "عنوان"}</p>
                    <p>{a.customerName}</p>
                    <p className="text-muted-foreground" dir="ltr" style={{ textAlign: "right" }}>{a.phone}</p>
                    <p className="text-muted-foreground">{a.city} — {a.address}</p>
                    {validLocation ? (
                      <a href={`https://www.google.com/maps/search/?api=1&query=${a.latitude},${a.longitude}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-xs text-primary hover:underline">
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        عرض على الخريطة
                      </a>
                    ) : (
                      <p className="text-xs text-destructive">الموقع غير صالح — عدّل العنوان وحدّد موقعك</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button type="button" variant="outline" className="h-11 flex-1 gap-1.5" onClick={() => setFormFor(a)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    تعديل
                  </Button>
                  <Button type="button" variant="outline" className="h-11 flex-1 gap-1.5 text-destructive hover:text-destructive" onClick={() => setDeleting(a)}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    حذف
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Button type="button" className="mt-4 h-12 w-full gap-2" onClick={() => setFormFor("new")} disabled={full}>
        <Plus className="h-5 w-5" aria-hidden="true" />
        إضافة عنوان جديد
      </Button>
      {full && <p className="mt-2 text-center text-xs text-muted-foreground">وصلت للحد الأقصى ({MAX_SAVED_ADDRESSES} عنواناً). احذف عنواناً لإضافة آخر.</p>}

      <Sheet open={formFor !== null} onOpenChange={(o) => !o && setFormFor(null)}>
        <SheetContent side="bottom" dir="rtl" className="max-h-[92vh] gap-0 overflow-y-auto rounded-t-2xl p-0 sm:mx-auto sm:max-w-lg">
          <SheetHeader className="border-b p-4 pr-14 text-right">
            <SheetTitle>{formFor === "new" ? "إضافة عنوان جديد" : "تعديل العنوان"}</SheetTitle>
            <SheetDescription className="sr-only">أدخل بيانات العنوان وحدّد موقعك ثم احفظ.</SheetDescription>
          </SheetHeader>
          <div className="p-4">
            {formFor && (
              <AddressForm
                key={formFor === "new" ? "new" : formFor.id}
                initial={formFor === "new" ? undefined : formFor}
                onCancel={() => setFormFor(null)}
                onSave={(input) => {
                  if (formFor === "new") addAddress(input)
                  else updateAddress(formFor.id, input)
                  toast({ title: formFor === "new" ? "تم حفظ العنوان" : "تم حفظ التعديلات" })
                  setFormFor(null)
                }}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle>حذف العنوان؟</AlertDialogTitle>
            <AlertDialogDescription>سيُحذف عنوان «{deleting?.label ?? deleting?.city}» من حسابك وجميع أجهزتك. لا يؤثر هذا على طلباتك السابقة.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:flex-row-reverse sm:justify-start">
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleting) removeAddress(deleting.id)
                setDeleting(null)
                toast({ title: "تم حذف العنوان" })
              }}
            >
              حذف
            </AlertDialogAction>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
