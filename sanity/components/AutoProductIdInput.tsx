"use client"

import { Button, Card, Flex, Stack, Text, TextInput } from "@sanity/ui"
import { Check, Copy, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { set, type StringInputProps, useClient, useFormValue } from "sanity"
import { apiVersion } from "@/sanity/env"

type CategoryReference = { _ref?: string }
type CategoryData = { slug?: string; subcategoryCount: number }

/** رقم ثابت وواضح للمنتج، يُنشأ بعد اكتمال اختيار القسم. */
export function AutoProductIdInput(props: StringInputProps) {
  const client = useClient({ apiVersion })
  const category = useFormValue(["category"]) as CategoryReference | undefined
  const subcategory = useFormValue(["subcategory"]) as string | undefined
  const documentId = useFormValue(["_id"]) as string | undefined
  const categoryId = category?._ref
  const [categoryData, setCategoryData] = useState<CategoryData | null>(null)
  const [copied, setCopied] = useState(false)
  const fallbackSuffix = useRef(Date.now().toString(36).toUpperCase())

  useEffect(() => {
    let active = true
    if (!categoryId) {
      setCategoryData(null)
      return () => {
        active = false
      }
    }

    client
      .fetch<CategoryData | null>(
        `*[_type == "category" && _id == $categoryId][0]{
          "slug": slug.current,
          "subcategoryCount": count(coalesce(subcategories, []))
        }`,
        { categoryId },
      )
      .then((result) => {
        if (active) setCategoryData(result)
      })
      .catch(() => {
        if (active) setCategoryData(null)
      })

    return () => {
      active = false
    }
  }, [categoryId, client])

  const canGenerate = Boolean(
    categoryData?.slug && (categoryData.subcategoryCount === 0 || subcategory),
  )

  const generatedId = useMemo(() => {
    if (!categoryData?.slug) return ""
    const suffix =
      documentId
        ?.replace(/^drafts\./, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(-8)
        .toUpperCase() || fallbackSuffix.current

    const categoryCode = shortCode(categoryData.slug, "CAT")
    const subcategoryCode = subcategory ? `-${shortCode(subcategory, "SUB")}` : ""
    return `TRF-${categoryCode}${subcategoryCode}-${suffix}`
  }, [categoryData?.slug, documentId, subcategory])

  useEffect(() => {
    if (!props.value && canGenerate && generatedId) props.onChange(set(generatedId))
  }, [canGenerate, generatedId, props.onChange, props.value])

  const regenerate = useCallback(() => {
    if (canGenerate && generatedId) props.onChange(set(generatedId))
  }, [canGenerate, generatedId, props.onChange])

  const copy = useCallback(async () => {
    if (!props.value) return
    await navigator.clipboard.writeText(props.value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [props.value])

  return (
    <Stack space={3}>
      <Flex gap={2} align="center">
        <TextInput
          {...props.elementProps}
          value={props.value ?? ""}
          readOnly
          placeholder="يُنشأ تلقائياً بعد اختيار القسم"
        />
        <Button
          aria-label="نسخ رقم المنتج"
          disabled={!props.value}
          icon={copied ? Check : Copy}
          mode="ghost"
          onClick={copy}
          tone={copied ? "positive" : "default"}
        />
        <Button
          aria-label="إعادة إنشاء رقم المنتج"
          disabled={!canGenerate}
          icon={RefreshCw}
          mode="ghost"
          onClick={regenerate}
        />
      </Flex>

      {!categoryId && (
        <Card padding={3} radius={2} tone="caution">
          <Text size={1}>ابدأ باختيار القسم الرئيسي.</Text>
        </Card>
      )}
      {categoryId && categoryData?.subcategoryCount !== 0 && !subcategory && (
        <Card padding={3} radius={2} tone="caution">
          <Text size={1}>اختر القسم الفرعي ليُنشأ رقم المنتج تلقائياً.</Text>
        </Card>
      )}
      {props.value && (
        <Text muted size={1}>هذا الرقم هو المعرّف الثابت للمنتج ويُستخدم أيضاً كرقم صنف افتراضي.</Text>
      )}
    </Stack>
  )
}

function shortCode(value: string, fallback: string) {
  const ascii = value.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return ascii.slice(0, 3) || fallback
}
