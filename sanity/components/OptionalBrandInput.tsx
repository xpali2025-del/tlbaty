"use client"

import { Button, Card, Flex, Stack, Text } from "@sanity/ui"
import { useEffect, useState } from "react"
import { type ReferenceInputProps, unset } from "sanity"

/** يجعل اختيار البراند قراراً واضحاً، ويبقيه اختيارياً بالكامل. */
export function OptionalBrandInput(props: ReferenceInputProps) {
  const [hasBrand, setHasBrand] = useState(Boolean(props.value))

  useEffect(() => {
    if (props.value) setHasBrand(true)
  }, [props.value])

  return (
    <Stack space={3}>
      <Flex gap={2} wrap="wrap">
        <Button
          disabled={props.readOnly}
          mode={!hasBrand ? "default" : "ghost"}
          onClick={() => {
            setHasBrand(false)
            props.onChange(unset())
          }}
          selected={!hasBrand}
          text="لا، بدون براند"
          tone={!hasBrand ? "primary" : "default"}
        />
        <Button
          disabled={props.readOnly}
          mode={hasBrand ? "default" : "ghost"}
          onClick={() => setHasBrand(true)}
          selected={hasBrand}
          text="نعم، تابع لبراند"
          tone={hasBrand ? "primary" : "default"}
        />
      </Flex>

      {hasBrand ? (
        props.renderDefault(props)
      ) : (
        <Card padding={3} radius={2} tone="transparent">
          <Text muted size={1}>يمكن حفظ المنتج بدون براند، وإضافته لاحقاً في أي وقت.</Text>
        </Card>
      )}
    </Stack>
  )
}
