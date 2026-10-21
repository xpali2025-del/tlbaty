"use client"

import { Card, Select, Spinner, Stack, Text } from "@sanity/ui"
import { useEffect, useState } from "react"
import { set, type StringInputProps, unset, useClient, useFormValue } from "sanity"
import { apiVersion } from "@/sanity/env"

type CategoryReference = { _ref?: string }
type CategoryOption = { name: string; slug: string }
type CategoryData = { name: string; subcategories: CategoryOption[] }

/** قائمة أقسام فرعية تتغير مباشرة عند اختيار القسم الرئيسي. */
export function SubcategoryInput(props: StringInputProps) {
  const client = useClient({ apiVersion })
  const category = useFormValue(["category"]) as CategoryReference | undefined
  const categoryId = category?._ref
  const [data, setData] = useState<CategoryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true

    if (!categoryId) {
      setData(null)
      setLoading(false)
      setFailed(false)
      return () => {
        active = false
      }
    }

    setLoading(true)
    setFailed(false)
    client
      .fetch<CategoryData | null>(
        `*[_type == "category" && _id == $categoryId][0]{
          name,
          "subcategories": coalesce(subcategories[]{name, "slug": slug.current}, [])
        }`,
        { categoryId },
      )
      .then((result) => {
        if (!active) return
        setData(result)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setData(null)
        setFailed(true)
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [categoryId, client])

  useEffect(() => {
    if (!data || !props.value) return
    const stillExists = data.subcategories.some((item) => item.slug === props.value)
    if (!stillExists) props.onChange(unset())
  }, [data, props.onChange, props.value])

  if (!categoryId) {
    return (
      <Card padding={3} radius={2} tone="caution">
        <Text size={1}>اختر القسم الرئيسي أولاً، ثم ستظهر أقسامه الفرعية هنا.</Text>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card padding={3} radius={2} tone="transparent">
        <Stack space={3}>
          <Spinner muted />
          <Text muted size={1}>جاري تحميل الأقسام الفرعية…</Text>
        </Stack>
      </Card>
    )
  }

  if (failed) {
    return (
      <Card padding={3} radius={2} tone="critical">
        <Text size={1}>تعذر تحميل الأقسام الفرعية. تحقق من الاتصال ثم أعد المحاولة.</Text>
      </Card>
    )
  }

  if (!data?.subcategories.length) {
    return (
      <Card padding={3} radius={2} tone="positive">
        <Text size={1}>هذا القسم لا يحتوي أقساماً فرعية، ويمكنك متابعة إدخال المنتج.</Text>
      </Card>
    )
  }

  return (
    <Select
      {...props.elementProps}
      value={props.value ?? ""}
      onChange={(event) => {
        const value = event.currentTarget.value
        props.onChange(value ? set(value) : unset())
      }}
    >
      <option value="">اختر القسم الفرعي</option>
      {data.subcategories.map((item) => (
        <option key={item.slug} value={item.slug}>
          {item.name}
        </option>
      ))}
    </Select>
  )
}
