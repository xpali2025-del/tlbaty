import { registerPreUpload, releasePreUpload, type PreUpload } from "@/lib/storage/preupload-registry"
import type { JobEntry } from "./core"

// ما تشترك فيه كل شاشات الحفظ الفوري: ما يبقى في الذاكرة لكل عملية، وتحويل النموذج إلى حقول وإعادته.

export type LiveJob = {
  /** الرفع المسبق لصور النموذج (يُسلَّم للتنفيذ بعد إغلاق النافذة). */
  pres: PreUpload[]
  /** روابط معاينة محلية للصور الجديدة، تُحرَّر عند الانتهاء. */
  previews: string[]
  /** ما تحتاجه شاشة بعينها (مثل فيديو الإعلان ورفع غلافه). */
  extra?: { videoPre?: PreUpload | null; posterPromise?: Promise<PreUpload | null> | null }
}

/** ما يبقى في الذاكرة فقط لكل عملية. بعد تحديث الصفحة لا يوجد، فيُرفع ما لم يُرفع من الملفات المحفوظة في العملية. */
export const live = new Map<string, LiveJob>()

/** حقول النموذج كما ستُرسل: النصوص والملفات المختارة فقط (ملف فارغ = لم يُختر شيء). */
export function formEntries(form: FormData): JobEntry[] {
  const out: JobEntry[] = []
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") out.push([name, value])
    else if (value.size > 0) out.push([name, value])
  }
  return out
}

/** أول ملف مختار في حقل (أو undefined). */
export function firstFile(form: FormData, field: string): File | undefined {
  return form.getAll(field).find((v): v is File => v instanceof File && v.size > 0)
}

/** منشئ روابط المعاينة: يتتبّعها ليحرّرها عند الانتهاء. */
export function previewMaker() {
  const urls: string[] = []
  return {
    urls,
    of(file: File | undefined): string | undefined {
      if (!file) return undefined
      const url = URL.createObjectURL(file)
      urls.push(url)
      return url
    },
  }
}

/** النموذج كاملاً من حقول العملية، بمعرّف العملية الثابت، مع إعادة تسجيل الرفع المسبق الجاري (أُزيل مع حقل الصورة). */
export function rebuildForm(jobId: string, entries: JobEntry[], requestId: string): FormData {
  const form = new FormData()
  for (const [name, value] of entries) form.append(name, value)
  form.set("requestId", requestId)
  const pres = live.get(jobId)?.pres ?? []
  for (const pre of pres) if (!pre.discarded && pre.state !== "error") registerPreUpload(pre)
  return form
}

/** يحرّر ما في الذاكرة لعملية انتهت أو أُلغيت. الرفع المسبق «أُرسل للحفظ» فلا يُحذف كائنه من التخزين. */
export function releaseLive(jobId: string) {
  const entry = live.get(jobId)
  if (!entry) return
  live.delete(jobId)
  for (const pre of entry.pres) releasePreUpload(pre)
  releasePreUpload(entry.extra?.videoPre)
  void entry.extra?.posterPromise?.then((poster) => releasePreUpload(poster))
  for (const url of entry.previews) URL.revokeObjectURL(url)
}
