/** Parses ADMIN_EMAILS (comma-separated) and checks a verified email against it. */
export function isAdminEmail(email: string | null | undefined, list = process.env.ADMIN_EMAILS) {
  if (!email || !list) return false
  const admins = list.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  return admins.includes(email.trim().toLowerCase())
}
