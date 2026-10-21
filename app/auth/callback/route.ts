import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Password-reset email link target. The redirect destination is fixed (no `next`
// parameter), so this can't be used as an open redirect.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL('/reset-password', request.url))
  }
  return NextResponse.redirect(new URL('/login', request.url))
}
