import { buildLegacyTheme } from "sanity"

// ============================================
// ثيم لوحة التحكم — فضي مزرق لامع
// ============================================

const props = {
  "--silver-blue-lightest": "#f2f6fa", // فضي فاتح لامع
  "--silver-blue-light": "#dde6ef", // فضي مزرق
  "--silver-blue": "#b9c9d9", // فضي مزرق متوسط
  "--steel-blue": "#5b8cbe", // أزرق فولاذي لامع
  "--steel-blue-dark": "#3f6a96", // أزرق فولاذي غامق
  "--slate-ink": "#22313f", // نص غامق مزرق
  "--white": "#ffffff",

  "--state-success": "#3d9970",
  "--state-warning": "#d9a441",
  "--state-danger": "#c0504d",
}

export const silverBlueTheme = buildLegacyTheme({
  // الخلفية والنصوص
  "--black": props["--slate-ink"],
  "--white": props["--silver-blue-lightest"],
  "--gray": "#8fa3b5",
  "--gray-base": "#8fa3b5",

  "--component-bg": props["--silver-blue-lightest"],
  "--component-text-color": props["--slate-ink"],

  // اللون الأساسي (العلامة)
  "--brand-primary": props["--steel-blue"],

  // الأزرار
  "--default-button-color": "#7b93a8",
  "--default-button-primary-color": props["--steel-blue"],
  "--default-button-success-color": props["--state-success"],
  "--default-button-warning-color": props["--state-warning"],
  "--default-button-danger-color": props["--state-danger"],

  // الحالات
  "--state-info-color": props["--steel-blue"],
  "--state-success-color": props["--state-success"],
  "--state-warning-color": props["--state-warning"],
  "--state-danger-color": props["--state-danger"],

  // الشريط الرئيسي والتنقل — فضي مزرق لامع
  "--main-navigation-color": props["--silver-blue-light"],
  "--main-navigation-color--inverted": props["--slate-ink"],

  "--focus-color": props["--steel-blue"],
})
