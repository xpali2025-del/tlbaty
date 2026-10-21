"use client"

import { useState, useTransition } from "react"
import { Pencil, User, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { AdminUser } from "@/lib/manage-users"
import { ROLES, ROLE_LABELS, ROLE_PRESETS, SCREENS, SCREEN_LABELS, type Role, type Screen } from "@/lib/permissions"
import { saveUser, deleteUser, toggleUserActive } from "../actions"
import { DeleteButton, SectionHeader } from "./shared"

export function UsersManager({
  users,
  currentUser,
}: {
  users: AdminUser[]
  currentUser: string | null
}) {
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleDelete(u: AdminUser) {
    startTransition(async () => {
      try {
        await deleteUser(u._id)
        toast.success("تم حذف المستخدم")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر الحذف")
      }
    })
  }

  function handleToggle(u: AdminUser, value: boolean) {
    startTransition(async () => {
      try {
        await toggleUserActive(u._id, value)
        toast.success(value ? "تم تفعيل المستخدم" : "تم تعطيل المستخدم")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر التحديث")
      }
    })
  }

  return (
    <div>
      <SectionHeader
        title="المستخدمون"
        description="أضِف حسابات دخول للوحة التحكم وحدّد صلاحياتها."
        onAdd={() => {
          setEditing(null)
          setOpen(true)
        }}
        addLabel="مستخدم جديد"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            لا يوجد مستخدمون بعد. أضِف أول مستخدم للسماح له بالدخول للوحة.
          </p>
        ) : null}
        {users.map((u) => {
          const isSelf = currentUser?.toLowerCase() === u.username.toLowerCase()
          return (
            <Card key={u._id} className="flex items-center gap-3 p-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10">
                {u.role === "admin" ? (
                  <ShieldCheck className="h-5 w-5 text-primary" />
                ) : (
                  <User className="h-5 w-5 text-primary" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold" dir="ltr">
                    {u.username}
                  </p>
                  <Badge variant={u.role === "admin" ? "default" : "secondary"}>{ROLE_LABELS[u.role]}</Badge>
                  {isSelf ? <Badge variant="outline">أنت</Badge> : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {u.name || "بدون اسم معروض"} · {u.permissions.length} شاشة
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Switch
                  checked={u.active}
                  onCheckedChange={(v) => handleToggle(u, v)}
                  disabled={isPending || isSelf}
                  aria-label="تفعيل/تعطيل المستخدم"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditing(u)
                    setOpen(true)
                  }}
                >
                  <Pencil className="h-4 w-4" />
                  <span className="sr-only">تعديل</span>
                </Button>
                {isSelf ? null : (
                  <DeleteButton onConfirm={() => handleDelete(u)} itemLabel={u.username} disabled={isPending} />
                )}
              </div>
            </Card>
          )
        })}
      </div>
      <UserDialog key={editing?._id ?? "new"} open={open} onOpenChange={setOpen} user={editing} />
    </div>
  )
}

function UserDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  user: AdminUser | null
}) {
  const [role, setRole] = useState<Role>(user?.role ?? "editor")
  const [permissions, setPermissions] = useState<Screen[]>(user?.permissions ?? [...ROLE_PRESETS.editor])
  const [active, setActive] = useState<boolean>(user?.active ?? true)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    form.set("role", role)
    form.set("permissions", JSON.stringify(permissions))
    form.set("active", active ? "true" : "false")
    startTransition(async () => {
      try {
        await saveUser(user?._id ?? null, form)
        toast.success(user ? "تم تحديث المستخدم" : "تمت إضافة المستخدم")
        onOpenChange(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "تعذّر الحفظ")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{user ? "تعديل المستخدم" : "مستخدم جديد"}</DialogTitle>
          <DialogDescription>
            بيانات الدخول للوحة التحكم. اسم المستخدم يُكتب بالإنجليزية بدون مسافات.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>
              اسم المستخدم <span className="text-destructive">*</span>
            </Label>
            <Input
              name="username"
              defaultValue={user?.username}
              required
              dir="ltr"
              autoComplete="off"
              placeholder="user123"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>الاسم المعروض</Label>
            <Input name="name" defaultValue={user?.name} placeholder="اسم صاحب الحساب" />
          </div>
          <div className="flex flex-col gap-2">
            <Label>
              كلمة المرور {user ? "" : <span className="text-destructive">*</span>}
            </Label>
            <Input
              name="password"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              placeholder={user ? "اتركها فارغة للإبقاء عليها" : "6 أحرف على الأقل"}
            />
            {user ? (
              <p className="text-xs text-muted-foreground">
                اتركها فارغة إذا لم ترغب بتغيير كلمة المرور.
              </p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>الصلاحية</Label>
              <Select
                value={role}
                onValueChange={(v) => {
                  setRole(v as Role)
                  setPermissions([...ROLE_PRESETS[v as Role]]) // الدور يملأ الصلاحيات الافتراضية ويمكن تعديلها بعده
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>الحالة</Label>
              <div className="flex h-10 items-center gap-2 rounded-md border px-3">
                <Switch checked={active} onCheckedChange={setActive} aria-label="مفعّل" />
                <span className="text-sm text-muted-foreground">{active ? "مفعّل" : "معطّل"}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>الشاشات المسموحة</Label>
            <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
              {SCREENS.map((screen) => (
                <label key={screen} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={permissions.includes(screen)}
                    onChange={(e) =>
                      setPermissions((prev) => (e.target.checked ? [...prev, screen] : prev.filter((p) => p !== screen)))
                    }
                  />
                  {SCREEN_LABELS[screen]}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              تُفرض الصلاحيات على الخادم في كل عملية، لا بإخفاء الشاشة فقط. حساب المالك (من متغيرات البيئة) يملك كل الصلاحيات دائماً.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "جارٍ الحفظ..." : "حفظ التغييرات"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
