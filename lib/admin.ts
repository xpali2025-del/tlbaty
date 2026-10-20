import 'server-only'
import { notFound } from 'next/navigation'
import { isAdminEmail } from '@/lib/admin-email'
import { getAuthUser } from '@/lib/supabase/server'

/**
 * Gate for admin pages AND every admin server action (actions are public POST
 * endpoints, so page-level checks alone are not enough). Requires a confirmed email.
 */
export async function requireAdmin() {
  const user = await getAuthUser()
  if (!user?.email_confirmed_at || !isAdminEmail(user.email)) notFound()
  return user
}
