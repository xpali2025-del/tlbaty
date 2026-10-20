"use client"

import { Card, Stack, Text } from "@sanity/ui"
import { type NumberInputProps, useFormValue } from "sanity"

/** يوضّح للمحرر نتيجة الخصم والتصنيف التلقائي ضمن العروض. */
export function DiscountPriceInput(props: NumberInputProps) {
  const price = useFormValue(["price"]) as number | undefined
  const oldPrice = props.value
  const validDiscount =
    typeof price === "number" && typeof oldPrice === "number" && oldPrice > price
  const percentage = validDiscount ? Math.round(((oldPrice - price) / oldPrice) * 100) : 0

  return (
    <Stack space={3}>
      {props.renderDefault(props)}
      {validDiscount && (
        <Card padding={3} radius={2} tone="positive">
          <Text size={1} weight="semibold">
            خصم {percentage}% — سيظهر المنتج تلقائياً ضمن قسم العروض.
          </Text>
        </Card>
      )}
    </Stack>
  )
}
