// طرق دخول العملاء: طريقة واحدة فعّالة يختارها المدير من الإعدادات (site_settings.login_method).

export type MethodKey = "wa_cloud" | "wa_web" | "sms" | "wa_web_sms" | "wa_chat" | "puk"

/** جاهزية الطريقة (بيانات الاعتماد والصحة الحية). النصوص عربية وتُعرض للمدير. */
export type ReadinessCheck = { ready: boolean; problems: string[] }

export interface LoginMethod {
  readonly key: MethodKey
  readonly kind: "code" | "chat" | "puk"
  /** يُستعمل في محدد الطريقة وصفحة الفحص. لا يرمي أبداً. */
  readiness(): Promise<ReadinessCheck>
}
