"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { AdminSettings } from "@/lib/admin"
import { saveSettings } from "../actions"
import { ImageField, SectionHeader } from "./shared"
import { uploadFormImages } from "@/lib/storage/upload-client"

export function SettingsManager({ settings }: { settings: AdminSettings }) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await uploadFormImages(form, [
          { name: "logo", folder: "site", keyName: "logoKey" },
        ])
        await saveSettings(settings?._id ?? null, form)
        toast.success("تم حفظ إعدادات الموقع")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "تعذّر الحفظ")
      }
    })
  }

  return (
    <div>
      <SectionHeader
        title="إعدادات الموقع"
        description="بيانات المتجر العامة ووسائل التواصل — تُحفظ مباشرة."
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">بيانات عامة</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ImageField name="logo" current={settings?.logo} label="شعار المتجر" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="اسم المتجر">
                <Input name="name" defaultValue={settings?.name ?? ""} />
              </Field>
              <Field label="الشعار النصي">
                <Input name="tagline" defaultValue={settings?.tagline ?? ""} />
              </Field>
            </div>
            <Field label="وصف المتجر">
              <Textarea name="description" defaultValue={settings?.description ?? ""} rows={3} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">بيانات التواصل</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="الهاتف">
              <Input name="phone" defaultValue={settings?.phone ?? ""} dir="ltr" />
            </Field>
            <Field label="واتساب">
              <Input name="whatsapp" defaultValue={settings?.whatsapp ?? ""} dir="ltr" />
            </Field>
            <Field label="البريد الإلكتروني">
              <Input name="email" type="email" defaultValue={settings?.email ?? ""} dir="ltr" />
            </Field>
            <Field label="ساعات العمل">
              <Input name="workingHours" defaultValue={settings?.workingHours ?? ""} />
            </Field>
            <Field label="العنوان">
              <Input name="address" defaultValue={settings?.address ?? ""} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">روابط التواصل الاجتماعي</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field label="إنستغرام">
              <Input name="instagram" defaultValue={settings?.social?.instagram ?? ""} dir="ltr" />
            </Field>
            <Field label="فيسبوك">
              <Input name="facebook" defaultValue={settings?.social?.facebook ?? ""} dir="ltr" />
            </Field>
            <Field label="تيك توك">
              <Input name="tiktok" defaultValue={settings?.social?.tiktok ?? ""} dir="ltr" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">الفوتر</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="نص الحقوق">
              <Input name="copyright" defaultValue={settings?.copyright ?? ""} />
            </Field>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? "جارٍ الحفظ..." : "حفظ التغييرات"}
          </Button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
