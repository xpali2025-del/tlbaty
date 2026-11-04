import { normalizePlacements, parseDateOnly } from "@/lib/ads"
import { isValidVideoKey } from "@/lib/storage/keys"
import { bool, json, num, str } from "./form"

/** قواعد الإعلان التي لا تحتاج قاعدة بيانات (الأقسام المختارة تُفلتر في الخادم بمن يوجد فعلاً). */
export function parseAdForm(form: FormData) {
  const title = str(form, "title")
  if (!title) throw new Error("اسم الإعلان مطلوب")
  const kind = str(form, "kind") === "video" ? ("video" as const) : ("image" as const)
  const newVideoKey = str(form, "videoKey")
  if (newVideoKey && !isValidVideoKey(newVideoKey)) throw new Error("مفتاح الفيديو غير صالح")
  const placements = normalizePlacements(json<unknown>(form, "placements", []))
  const startsOn = parseDateOnly(str(form, "startsOn")) ?? null
  const endsOn = parseDateOnly(str(form, "endsOn")) ?? null
  if (str(form, "startsOn") && !startsOn) throw new Error("تاريخ البداية غير صالح")
  if (str(form, "endsOn") && !endsOn) throw new Error("تاريخ النهاية غير صالح")
  if (startsOn && endsOn && startsOn > endsOn) throw new Error("تاريخ النهاية يجب ألا يسبق تاريخ البداية")
  return {
    title,
    kind,
    newVideoKey,
    placements,
    startsOn,
    endsOn,
    href: str(form, "href") ?? null,
    active: bool(form, "active"),
    frequency: Math.max(1, Math.trunc(num(form, "frequency") ?? 6)),
    sortOrder: Math.trunc(num(form, "sortOrder") ?? 0),
    requestedCategoryIds: json<string[]>(form, "categoryIds", []).filter((c) => typeof c === "string"),
  }
}
