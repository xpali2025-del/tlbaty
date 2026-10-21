import { redirect } from "next/navigation"
import { isManageAuthed, isManageConfigured } from "@/lib/manage-auth"
import { LoginForm } from "./login-form"

// قراءة الكوكي في isManageAuthed تجعل الصفحة ديناميكية تلقائياً.

export default async function LoginPage() {
  if (await isManageAuthed()) {
    redirect("/manage")
  }

  const configured = await isManageConfigured()

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <LoginForm configured={configured} />
    </div>
  )
}
