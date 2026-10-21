"use client"

import { Box, Card, Container, Flex, Grid, Heading, Stack, Text } from "@sanity/ui"
import {
  BadgePercent,
  Boxes,
  FolderTree,
  Images,
  LayoutDashboard,
  Megaphone,
  PackagePlus,
  PackageSearch,
  Settings,
  ShoppingBag,
  Star,
  Tags,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { useClient } from "sanity"
import { IntentLink } from "sanity/router"
import { apiVersion } from "@/sanity/env"

type Stats = {
  products: number
  categories: number
  brands: number
  activeAds: number
}

const managementLinks: Array<{
  title: string
  description: string
  href: string
  icon: LucideIcon
  tone?: "primary" | "positive" | "caution"
}> = [
  {
    title: "كل المنتجات",
    description: "البحث والتعديل ومراجعة المنتجات",
    href: "/studio/structure/product",
    icon: PackageSearch,
    tone: "primary",
  },
  {
    title: "الأقسام",
    description: "الأقسام الرئيسية والفرعية",
    href: "/studio/structure/category",
    icon: FolderTree,
  },
  {
    title: "البراندات",
    description: "إضافة البراندات وشعاراتها",
    href: "/studio/structure/brand",
    icon: Tags,
  },
  {
    title: "الإعلانات",
    description: "الإعلانات التي تظهر بين المنتجات",
    href: "/studio/structure/ad",
    icon: Megaphone,
    tone: "caution",
  },
  {
    title: "سلايدر الرئيسية",
    description: "صور وعروض أعلى الصفحة الرئيسية",
    href: "/studio/structure/slide",
    icon: Images,
  },
  {
    title: "أكواد الخصم",
    description: "إنشاء وإدارة أكواد الخصومات",
    href: "/studio/structure/coupon",
    icon: BadgePercent,
    tone: "positive",
  },
  {
    title: "آراء العملاء",
    description: "إضافة ومراجعة التقييمات",
    href: "/studio/structure/review",
    icon: Star,
  },
  {
    title: "إعدادات المتجر",
    description: "الشعار والتواصل والقوائم والفوتر",
    href: "/studio/structure/siteSettings",
    icon: Settings,
  },
  {
    title: "الطلبات",
    description: "فتح لوحة الطلبات المنفصلة",
    href: "/studio-orders",
    icon: ShoppingBag,
    tone: "positive",
  },
]

export function StoreDashboard() {
  const client = useClient({ apiVersion })
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    let active = true
    client
      .fetch<Stats>(`{
        "products": count(*[_type == "product"]),
        "categories": count(*[_type == "category"]),
        "brands": count(*[_type == "brand"]),
        "activeAds": count(*[_type == "ad" && active == true])
      }`)
      .then((result) => {
        if (active) setStats(result)
      })
      .catch(() => {
        if (active) setStats(null)
      })

    return () => {
      active = false
    }
  }, [client])

  return (
    <Box dir="rtl" height="fill" overflow="auto">
      <Container width={4} padding={[3, 3, 4]} sizing="border">
        <Stack space={3}>
          <Card padding={[3, 3, 4]} radius={3} shadow={1} tone="primary">
            <Flex align={["stretch", "center"]} direction={["column", "row"]} gap={3} justify="space-between">
              <Stack space={3}>
                <Flex align="center" gap={2}>
                  <Boxes size={26} />
                  <Heading as="h1" size={[2, 2, 3]}>لوحة إدارة متجر تاج لاين</Heading>
                </Flex>
                <Text size={1}>أدخل المنتجات بسرعة، ثم أضف الخيارات وبيانات SEO لاحقاً عند الحاجة.</Text>
              </Stack>

              <IntentLink
                intent="create"
                params={{ type: "product" }}
                style={{ color: "inherit", textDecoration: "none" }}
              >
                <Card padding={3} radius={2} shadow={1} tone="default">
                  <Flex align="center" gap={2} justify="center">
                    <PackagePlus size={22} />
                    <Text size={1} weight="semibold">إضافة منتج جديد</Text>
                  </Flex>
                </Card>
              </IntentLink>
            </Flex>
          </Card>

          <Grid columns={[2, 2, 4]} gap={2}>
            <StatCard label="المنتجات" value={stats?.products} />
            <StatCard label="الأقسام" value={stats?.categories} />
            <StatCard label="البراندات" value={stats?.brands} />
            <StatCard label="إعلانات مفعّلة" value={stats?.activeAds} />
          </Grid>

          <Stack space={2}>
            <Heading as="h2" size={1}>إدارة المتجر</Heading>
            <Grid columns={[2, 2, 3]} gap={2}>
              {managementLinks.map((item) => (
                <DashboardLink key={item.href} {...item} />
              ))}
            </Grid>
          </Stack>

          <Card border padding={3} radius={2} tone="transparent">
            <Stack space={3}>
              <Heading as="h2" size={1}>طريقة إدخال المنتج السريعة</Heading>
              <Text muted size={1}>
                اختر القسم ثم القسم الفرعي، وانتظر إنشاء رقم المنتج. بعد ذلك أدخل الاسم والسعر والوصف والصورة.
                البراند والخيارات وSEO اختيارية، والسعر قبل الخصم يضيف المنتج إلى العروض تلقائياً.
              </Text>
            </Stack>
          </Card>
        </Stack>
      </Container>
    </Box>
  )
}

function StatCard({ label, value }: { label: string; value?: number }) {
  return (
    <Card border padding={3} radius={2}>
      <Stack space={2}>
        <Text muted size={1}>{label}</Text>
        <Heading as="p" size={[2, 2, 3]}>{value ?? "—"}</Heading>
      </Stack>
    </Card>
  )
}

function DashboardLink({
  title,
  description,
  href,
  icon: Icon,
  tone = "primary",
}: {
  title: string
  description: string
  href: string
  icon: LucideIcon
  tone?: "primary" | "positive" | "caution"
}) {
  return (
    <a href={href} style={{ color: "inherit", textDecoration: "none" }}>
      <Card border padding={3} radius={2} height="fill" tone={tone === "primary" ? "default" : tone}>
        <Flex align="flex-start" gap={2}>
          <Card padding={2} radius={2} tone={tone}>
            <Icon size={18} />
          </Card>
          <Stack space={2}>
            <Text size={1} weight="semibold">{title}</Text>
            <Text muted size={1}>{description}</Text>
          </Stack>
        </Flex>
      </Card>
    </a>
  )
}

export const storeDashboardTool = {
  name: "dashboard",
  title: "الرئيسية",
  icon: LayoutDashboard,
  component: StoreDashboard,
}
