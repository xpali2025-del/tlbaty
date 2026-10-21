import { NextResponse } from "next/server"
import { getChallengeForBrowser } from "@/lib/otp/chat-login"
import { maskLocalPhone } from "@/lib/phone"

export const runtime = "nodejs"

/** حالة طلب الدخول لهذا المتصفح: waiting (لم يراسلنا بعد) أو claimed (أرسلنا له الرمز) أو expired. */
export async function GET() {
  const challenge = await getChallengeForBrowser()
  if (!challenge) return NextResponse.json({ state: "expired" })
  if (!challenge.claimedAt || !challenge.phone) return NextResponse.json({ state: "waiting" })
  return NextResponse.json({ state: "claimed", phoneMasked: maskLocalPhone(challenge.phone) })
}
