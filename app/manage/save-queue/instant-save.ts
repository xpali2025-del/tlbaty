"use client"

import { useSyncExternalStore } from "react"

// مفتاح رجوع: الحفظ الفوري للمنتجات مفعّل افتراضياً. إيقافه يعيد السلوك القديم (انتظار الحفظ ثم إغلاق النافذة)
// وهو لكل متصفح (localStorage)، فيستطيع المدير تعطيله فوراً إن ظهر خلل دون نشر جديد.

const KEY = "manage:instant-save"
const EVENT = "manage:instant-save-change"

export function isInstantSaveEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off"
  } catch {
    return true
  }
}

export function setInstantSave(enabled: boolean) {
  try {
    window.localStorage.setItem(KEY, enabled ? "on" : "off")
  } catch {
    // التخزين غير متاح: يبقى الافتراضي
  }
  window.dispatchEvent(new Event(EVENT))
}

export function useInstantSave(): boolean {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener(EVENT, listener)
      window.addEventListener("storage", listener)
      return () => {
        window.removeEventListener(EVENT, listener)
        window.removeEventListener("storage", listener)
      }
    },
    isInstantSaveEnabled,
    () => true,
  )
}
