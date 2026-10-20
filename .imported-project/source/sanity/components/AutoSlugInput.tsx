"use client"

import { useEffect, useMemo, useRef } from "react"
import { set, type SlugInputProps, useFormValue } from "sanity"

/**
 * يولّد الرابط من الاسم تلقائياً أثناء إنشاء المستند.
 * إذا عدّل المحرر الرابط يدوياً نتوقف عن استبداله.
 */
export function AutoSlugInput(props: SlugInputProps) {
  const sourcePath = useMemo(
    () => [...props.path.slice(0, -1), "name"],
    [props.path],
  )
  const name = useFormValue(sourcePath) as string | undefined
  const current = props.value?.current
  const lastGenerated = useRef<string | undefined>(undefined)

  useEffect(() => {
    const next = slugify(name ?? "")
    if (!next) return

    const canKeepInSync = !current || current === lastGenerated.current
    if (canKeepInSync && current !== next) {
      lastGenerated.current = next
      props.onChange(set({ _type: "slug", current: next }))
    }
  }, [current, name, props.onChange])

  return props.renderDefault(props)
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .trim()
    .toLocaleLowerCase("ar")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
}
